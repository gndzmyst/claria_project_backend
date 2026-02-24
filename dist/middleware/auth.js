"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.generateToken = generateToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// ─────────────────────────────────────────────────────────────────────────────
// requireAuth
// Middleware untuk proteksi route — verifikasi JWT dari header Authorization
// Header format: "Authorization: Bearer <token>"
// ─────────────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized: No token provided" });
        return;
    }
    const token = authHeader.split(" ")[1];
    try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error("JWT_SECRET is not configured");
        }
        const payload = jsonwebtoken_1.default.verify(token, secret);
        req.user = payload;
        next();
    }
    catch (err) {
        if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({ error: "Unauthorized: Token has expired" });
        }
        else if (err instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            res.status(401).json({ error: "Unauthorized: Invalid token" });
        }
        else {
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// generateToken
// Buat JWT baru untuk user yang berhasil login
// ─────────────────────────────────────────────────────────────────────────────
function generateToken(payload) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jsonwebtoken_1.default.sign(payload, secret, {
        expiresIn: (process.env.JWT_EXPIRES_IN ||
            "7d"),
    });
}
//# sourceMappingURL=auth.js.map