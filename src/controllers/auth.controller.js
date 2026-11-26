const userModel = require("../models/user.model");
const blacklistModel = require("../models/blacklist.model");
const jwt = require("jsonwebtoken");
const emailService = require("../services/email.service");

async function register(req, res) {
    const { email, password, name } = req.body;

    const isExists = await userModel.findOne({
        email: email
    });
    if (isExists) {
        return res.status(422).json({
            message: "User already exists with email.",
            status: "failed"
        });
    }

    const user = await userModel.create({
        email, password, name
    });
    const token = jwt.sign({ userID: user._id }, process.env.JWT_SECRET, { expiresIn: "3d" });

    res.cookie("token", token, { httpOnly: true, maxAge: 3 * 24 * 60 * 60 * 1000 });

    await emailService.sendRegistrationEmail(user.email, user.name);

    res.status(201).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token
    });
}

async function login(req, res) {
    const { email, password } = req.body;

    const user = await userModel.findOne({ email }).select("+password");
    if (!user) {
        return res.status(401).json({
            message: "Invalid email or password",
            status: "failed"
        });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        return res.status(401).json({
            message: "Invalid email or password",
            status: "failed"
        });
    }

    const token = jwt.sign({ userID: user._id }, process.env.JWT_SECRET, { expiresIn: "3d" });

    res.cookie("token", token, { httpOnly: true, maxAge: 3 * 24 * 60 * 60 * 1000 });

    res.status(200).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token
    });
}

async function logout(req, res) {
    const token = req.headers?.authorization?.split(" ")[1] || req.cookies?.token;

    // Logging out is idempotent: always clear the cookie, and blacklist the token if one was sent.
    if (token) {
        try {
            await blacklistModel.updateOne(
                { token },
                { $setOnInsert: { token } },
                { upsert: true }
            );
        } catch (error) {
            return res.status(500).json({
                message: "Logout failed",
                status: "failed",
                error: error.message
            });
        }
    }

    res.clearCookie("token");
    return res.status(200).json({
        message: "Logged out successfully",
        status: "success"
    });
}

module.exports = {
    register,
    login,
    logout
};
