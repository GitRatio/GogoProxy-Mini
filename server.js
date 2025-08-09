import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));

const PORT = process.env.PORT || 10000;

let GoGoAnime;
try {
  const gogo = await import('gogoanime-api');
  GoGoAnime = new gogo.GoGoAnime();
} catch (err) {
  console.error('Failed to load gogoanime-api:', err);
}

app.get('/ping', (req, res) => res.json({ ok: true, provider: 'gogo', time: new Date().toISOString() }));

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json([]);
  try {
    const results = await GoGoAnime.search(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`[gogo-proxy] running on ${PORT}`));