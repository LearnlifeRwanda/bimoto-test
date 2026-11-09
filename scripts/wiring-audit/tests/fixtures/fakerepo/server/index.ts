// Fixture server registration point. Mirrors the real index.ts shapes:
// router mounts, a pathless middleware, a non-router mount, and a
// direct app.get registration.
import express from 'express';
import thingRoutes from './routes/thing.routes';
import csvRoutes from './routes/csv.routes';

const app = express();

app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/api/things', thingRoutes);
// LOOSE-ENDS G1.2 — the tokenizer-desynchronisation reproduction. Its
// endpoints are declared BELOW a regex-inside-${...} shape, so they
// only appear in the map when the tokenizer keeps its place.
app.use('/api/csv', csvRoutes);
app.get('/api/docs.json', (_req: unknown, res: { json: (v: unknown) => void }) => res.json({}));

export { app };
