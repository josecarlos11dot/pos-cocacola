// /api/state.js — usa MongoDB Atlas Data API (sin dependencias)
const DATA_API_URL = process.env.DATA_API_URL;              // p.ej. https://us-east-1.aws.data.mongodb-api.com/app/xxxx/endpoint/data/v1
const DATA_API_KEY = process.env.DATA_API_KEY;              // la API Key que generaste en App Services
const DATA_SOURCE  = process.env.DATA_API_DATA_SOURCE;      // normalmente "Cluster0"
const DB_NAME      = process.env.MONGO_DB || "pos_coca";    // tu DB
const COLL         = "pos_state";
const DOC_ID       = "estado";

async function dataApi(path, body) {
  const res = await fetch(`${DATA_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": DATA_API_KEY,
      "Access-Control-Request-Headers": "*",
    },
    body: JSON.stringify({
      dataSource: DATA_SOURCE,
      database: DB_NAME,
      collection: COLL,
      ...body,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Data API ${res.status}: ${t}`);
  }
  return res.json();
}

// parseo robusto del body (Vercel a veces no lo entrega parseado)
async function readJSON(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const out = await dataApi("/action/findOne", { filter: { _id: DOC_ID } });
      return res.status(200).json(out.document?.state || null);
    }

    if (req.method === "POST") {
      const body = await readJSON(req);
      const { state } = body || {};
      if (!state) return res.status(400).json({ error: "state required" });

      const stamp = new Date().toISOString();
      await dataApi("/action/updateOne", {
        filter: { _id: DOC_ID },
        update: { $set: { state: { ...state, updatedAt: stamp }, updatedAt: stamp } },
        upsert: true,
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
};
