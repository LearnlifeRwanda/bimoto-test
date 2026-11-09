// MONEY-VIEW v2 fixture — a selector given ONE definition for several exits
// to share, which is the shape that used to become an UNKNOWN at each one.
//
// Deliberately NESTED, and deliberately reaching a PROTECTED model. Nested,
// because the identifier inside the outer selector belongs to THIS file's
// scope and the importing file never sees it — resolving only the outer one
// moves the unknown a level down rather than removing it. Protected,
// because the point of resolving a selector is to SEE what it traverses
// into: an unresolved read is not a clean read, it is a read the guard
// cannot reason about.
export const SHARED_CHAT_INCLUDE = { orderBy: { createdAt: 'asc' } };

export const SHARED_DETAIL_INCLUDE = {
  messages: SHARED_CHAT_INCLUDE,
  legs: { orderBy: { sequence: 'asc' } },
};
