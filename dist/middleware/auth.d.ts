import { Request, Response, NextFunction } from "express";
export interface AuthPayload {
    userId: string;
    email: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export declare function generateToken(payload: AuthPayload): string;
