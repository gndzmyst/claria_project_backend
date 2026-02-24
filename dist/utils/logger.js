"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Buat folder logs kalau belum ada
const logsDir = path_1.default.join(process.cwd(), "logs");
if (!fs_1.default.existsSync(logsDir)) {
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
exports.logger = winston_1.default.createLogger({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
        return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    })),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length
                    ? ` ${JSON.stringify(meta)}`
                    : "";
                return `[${timestamp}] ${level}: ${message}${metaStr}`;
            })),
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, "error.log"),
            level: "error",
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, "combined.log"),
        }),
    ],
});
//# sourceMappingURL=logger.js.map