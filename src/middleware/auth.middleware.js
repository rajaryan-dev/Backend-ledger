const userModel = require("../models/user.model");
const blacklistModel = require("../models/blacklist.model");
const jwt = require("jsonwebtoken");

function extractToken(req) {
    return req.headers?.authorization?.split(" ")[1] || req.cookies?.token;
}

async function authMiddleware(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({
            message: "Unauthorized access, token is missing"
        });
    }

    try {
        if (await blacklistModel.findOne({ token })) {
            return res.status(401).json({
                message: "Unauthorized access, token is no longer valid"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userModel.findById(decoded.userID || decoded.userId);
        if (!user) {
            return res.status(401).json({
                message: "Unauthorized access, user not found"
            });
        }

        req.user = user;
        return next();
    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        });
    }
}

async function authSystemMiddleware(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({
            message: "Unauthorized access, token is missing"
        });
    }

    try {
        if (await blacklistModel.findOne({ token })) {
            return res.status(401).json({
                message: "Unauthorized access, token is no longer valid"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userModel.findById(decoded.userID || decoded.userId).select("+systemUser");

        if (!user || !user.systemUser) {
            return res.status(403).json({
                message: "Forbidden access, not a system user"
            });
        }

        req.user = user;
        return next();
    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        });
    }
}

module.exports = {
    authMiddleware,
    authSystemMiddleware
};
