import { Types } from 'mongoose';

/**
 * Parses a Mongo ObjectID without throwing. `new Types.ObjectId(…)` raises on a
 * malformed id, but a query built from untrusted input wants a miss, not an
 * exception — so callers can treat `null` as "no such document".
 *
 * This is the runtime counterpart to the `@IsObjectID()` DTO decorator: use the
 * decorator to reject bad input at the edge, this to guard an id that reached a
 * service anyway (a route param, a cross-database string reference).
 */
export function toObjectId(id: string): Types.ObjectId | null {
  try {
    return new Types.ObjectId(id);
  } catch {
    return null;
  }
}
