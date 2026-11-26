require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../src/models/user.model");
const accountModel = require("../src/models/account.model");

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // 1. Update existing users that do not have systemUser field
    await userModel.updateMany(
        { systemUser: { $exists: false } },
        { $set: { systemUser: false } }
    );
    console.log("Updated existing users with systemUser: false");

    // 2. Check if a System User already exists
    let systemUser = await userModel.findOne({ systemUser: true }).select("+systemUser");

    if (!systemUser) {
        systemUser = await userModel.create({
            name: "System",
            email: "system@backendledger.com",
            password: process.env.SYSTEM_USER_PASSWORD || "SystemPassword123",
            systemUser: true
        });
        console.log("Created System User:", systemUser._id);
    } else {
        console.log("System User already exists:", systemUser._id);
    }

    // 3. Ensure System User has a primary account
    let systemAccount = await accountModel.findOne({ user: systemUser._id });
    if (!systemAccount) {
        systemAccount = await accountModel.create({
            user: systemUser._id,
            status: "ACTIVE",
            currency: "INR"
        });
        console.log("Created System Account:", systemAccount._id);
    } else {
        console.log("System Account already exists:", systemAccount._id);
    }

    await mongoose.disconnect();
    console.log("Done!");
}

seed().catch(err => {
    console.error("Seeding error:", err);
    process.exit(1);
});
