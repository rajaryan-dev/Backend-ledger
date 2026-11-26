const mongoose = require("mongoose");
const blacklistSchema = new mongoose.Schema({
    token: {
        type: String,
        required: [true, "Token is required to blacklist"],
        unique: true
    }
}, {
    timestamps: true
});

blacklistSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 });

module.exports = mongoose.model("blacklist", blacklistSchema);
