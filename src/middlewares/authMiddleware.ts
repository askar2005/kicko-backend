import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'kicko_jwt_secret_token_123_key';

export interface AuthUser {
  id: string;
  email: string;
  role: 'customer' | 'owner' | 'admin';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction): any => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token is required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    
    (req as any).user = decoded as AuthUser;
    next();
  });
};

export const requireRole = (roles: Array<'customer' | 'owner' | 'admin'>) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    const user = (req as any).user as AuthUser;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Unauthorized: Access denied for this role.' });
    }
    next();
  };
};
