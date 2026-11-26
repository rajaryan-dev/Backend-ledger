const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require("../services/email.service");
const mongoose = require("mongoose");

function isValidAmount(amount) {
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

// Returns an early response if this idempotency key was already used, otherwise null.
async function handleExistingTransaction(idempotencyKey, res) {
    const existing = await transactionModel.findOne({ idempotencyKey });
    if (!existing) return null;

    if (existing.status === "COMPLETED") {
        return res.status(200).json({
            message: "Transaction already processed",
            transaction: existing
        });
    }
    if (existing.status === "PENDING") {
        return res.status(200).json({
            message: "Transaction is still processing"
        });
    }
    if (existing.status === "FAILED") {
        return res.status(500).json({
            message: "Transaction processing failed, please retry with a new idempotencyKey"
        });
    }
    return res.status(500).json({
        message: "Transaction was reversed, please retry with a new idempotencyKey"
    });
}

async function createTransaction(req, res) {
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body;

    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "fromAccount, toAccount, amount and idempotencyKey are required"
        });
    }

    if (!isValidAmount(amount)) {
        return res.status(400).json({
            message: "Transaction amount must be a number greater than 0"
        });
    }

    if (!mongoose.isValidObjectId(fromAccount) || !mongoose.isValidObjectId(toAccount)) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        });
    }

    if (fromAccount.toString() === toAccount.toString()) {
        return res.status(400).json({
            message: "Cannot transfer money to the same account"
        });
    }

    const fromUserAccount = await accountModel.findOne({ _id: fromAccount });
    const toUserAccount = await accountModel.findOne({ _id: toAccount });

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        });
    }

    // Only the owner of the sender account may move money out of it
    if (fromUserAccount.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            message: "You are not authorized to transfer from this account"
        });
    }

    const early = await handleExistingTransaction(idempotencyKey, res);
    if (early) return early;

    if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
        });
    }

    const session = await mongoose.startSession();
    try {
        let transaction;

        await session.withTransaction(async () => {
            // Balance is derived from the ledger, so read it inside the transaction
            const balance = await fromUserAccount.getBalance(session);
            if (balance < amount) {
                const err = new Error(`Insufficient balance. Current balance is ${balance}, requested amount is ${amount}`);
                err.statusCode = 400;
                throw err;
            }

            [transaction] = await transactionModel.create([{
                fromAccount,
                toAccount,
                amount,
                idempotencyKey,
                status: "COMPLETED"
            }], { session });

            await ledgerModel.create([
                { account: fromAccount, amount, transaction: transaction._id, type: "DEBIT" },
                { account: toAccount, amount, transaction: transaction._id, type: "CREDIT" }
            ], { session, ordered: true });
        });

        // Email is best-effort; it must not turn a committed transfer into an error
        emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toAccount)
            .catch(err => console.error("Transaction email failed:", err.message));

        return res.status(201).json({
            message: "Transaction completed successfully",
            transaction
        });
    } catch (error) {
        // Same idempotencyKey submitted concurrently
        if (error.code === 11000) {
            return res.status(409).json({
                message: "A transaction with this idempotencyKey is already being processed"
            });
        }

        if (error.statusCode === 400) {
            return res.status(400).json({ message: error.message });
        }

        emailService.sendTransactionFailureEmail(req.user.email, req.user.name, amount, toAccount)
            .catch(err => console.error("Failure email failed:", err.message));

        return res.status(500).json({
            message: "Transaction failed",
            error: error.message
        });
    } finally {
        await session.endSession();
    }
}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body;

    if (!toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required"
        });
    }

    if (!isValidAmount(amount)) {
        return res.status(400).json({
            message: "Amount must be a number greater than 0"
        });
    }

    if (!mongoose.isValidObjectId(toAccount)) {
        return res.status(400).json({
            message: "Invalid toAccount"
        });
    }

    const toUserAccount = await accountModel.findOne({ _id: toAccount });
    if (!toUserAccount) {
        return res.status(400).json({
            message: "Invalid toAccount"
        });
    }

    const fromUserAccount = await accountModel.findOne({ user: req.user._id });
    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found"
        });
    }

    const early = await handleExistingTransaction(idempotencyKey, res);
    if (early) return early;

    const session = await mongoose.startSession();
    try {
        let transaction;

        // The system account is the source of funds, so no balance check
        await session.withTransaction(async () => {
            [transaction] = await transactionModel.create([{
                fromAccount: fromUserAccount._id,
                toAccount,
                amount,
                idempotencyKey,
                status: "COMPLETED"
            }], { session });

            await ledgerModel.create([
                { account: fromUserAccount._id, amount, transaction: transaction._id, type: "DEBIT" },
                { account: toAccount, amount, transaction: transaction._id, type: "CREDIT" }
            ], { session, ordered: true });
        });

        return res.status(201).json({
            message: "Initial funds transaction completed successfully",
            transaction
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "A transaction with this idempotencyKey is already being processed"
            });
        }
        return res.status(500).json({
            message: "Transaction failed",
            error: error.message
        });
    } finally {
        await session.endSession();
    }
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
};
