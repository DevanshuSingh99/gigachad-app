import type { AuthContext } from '../lib/authContext';
import type { Logger } from '../lib/logger';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requestId middleware; echoed in every error body and log line. */
      requestId: string;
      /** Child logger already carrying requestId, so no call site has to add it. */
      log: Logger;
      /** Set by the requestLog middleware to enrich the completion line. */
      logFields?: Record<string, unknown>;
      /**
       * Set by requireAuth. Read it through authOf()/membershipOf() rather than
       * directly: those assert the guard actually ran, which the type system
       * cannot know on its own.
       */
      auth?: AuthContext;
    }
  }
}

export {};
