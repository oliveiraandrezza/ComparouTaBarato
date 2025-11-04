/* server.js - backend Comparou Tá Barato */

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

/* ===== App ===== */
const app = express();
app.use(cors());
app.use(express.json());

/* Healthcheck */
app.get("/", (req, res) => {
  res.send("OK");
});

/* Front-end estático */
app.use(express.static(path.join(__dirname, "public")));

/* ===== Config de Login simples ===== */
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "1234";
const activeTokens = new Set();

function genToken() {
  return (
    Math.random().toString(36).substring(2) +
    Date.now().toString(36).slice(2)
  );
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "").trim();
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

app.post("/login", (req, res) => {
  const { user, pass } = req.body || {};
  if (String(user) === ADMIN_USER && String(pass) === ADMIN_PASS) {
    const t = genToken();
    activeTokens.add(t);
    return res.json({ token: t });
  }
  return res.status(401).json({ error: "Credenciais inválidas" });
});

/* ===== Conexão MySQL com pool ===== */
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "12345",
  database: process.env.DB_NAME || "comparou",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 5
});

db.getConnection((err, conn) => {
  if (err) {
    console.error("MySQL não disponível agora:", err.message);
  } else {
    console.log("Pool MySQL ok");
    conn.release();
  }
});

/* Helper para executar SQL com promessa */
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* ===== Rotas API de promoções ===== */
/*
  Tabela esperada: promotions
  colunas: id, product, brand, store, price, unit, category, region, updated_at
*/

app.get("/promotions", async (req, res) => {
  try {
    const { region } = req.query;
    if (region && region !== "Todas") {
      const rows = await query(
        "SELECT id, product, brand, store, price, unit, category, region, updated_at FROM promotions WHERE LOWER(region) = LOWER(?) ORDER BY updated_at DESC, id DESC",
        [region]
      );
      return res.json(rows);
    }
    const rows = await query(
      "SELECT id, product, brand, store, price, unit, category, region, updated_at FROM promotions ORDER BY updated_at DESC, id DESC"
    );
    return res.json(rows);
  } catch (err) {
    console.error("Erro GET /promotions:", err.message);
    return res.status(500).json({ error: "Erro ao listar promoções" });
  }
});

app.post("/promotions", auth, async (req, res) => {
  try {
    const { product, brand, store, price, unit, category, region } = req.body || {};
    if (!product || !price || !unit) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }
    const result = await query(
      "INSERT INTO promotions (product, brand, store, price, unit, category, region, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
      [
        String(product).trim(),
        brand ? String(brand).trim() : null,
        store ? String(store).trim() : null,
        String(price).trim(),
        String(unit).trim(),
        category ? String(category).trim() : null,
        region ? String(region).trim() : null
      ]
    );
    const inserted = await query(
      "SELECT id, product, brand, store, price, unit, category, region, updated_at FROM promotions WHERE id = ?",
      [result.insertId]
    );
    return res.status(201).json(inserted[0]);
  } catch (err) {
    console.error("Erro POST /promotions:", err.message);
    return res.status(500).json({ error: "Erro ao criar promoção" });
  }
});

app.put("/promotions/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const { product, brand, store, price, unit, category, region } = req.body || {};
    const result = await query(
      "UPDATE promotions SET product = ?, brand = ?, store = ?, price = ?, unit = ?, category = ?, region = ?, updated_at = NOW() WHERE id = ?",
      [
        product ? String(product).trim() : null,
        brand ? String(brand).trim() : null,
        store ? String(store).trim() : null,
        price != null ? String(price).trim() : null,
        unit ? String(unit).trim() : null,
        category ? String(category).trim() : null,
        region ? String(region).trim() : null,
        id
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Promoção não encontrada" });
    }
    const updated = await query(
      "SELECT id, product, brand, store, price, unit, category, region, updated_at FROM promotions WHERE id = ?",
      [id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error("Erro PUT /promotions/:id:", err.message);
    return res.status(500).json({ error: "Erro ao atualizar promoção" });
  }
});

app.delete("/promotions/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const result = await query("DELETE FROM promotions WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Promoção não encontrada" });
    }
    return res.status(204).end();
  } catch (err) {
    console.error("Erro DELETE /promotions/:id:", err.message);
    return res.status(500).json({ error: "Erro ao excluir promoção" });
  }
});

/* ===== Start ===== */
const PORT = Number(process.env.PORT) || 8081;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`Abra no PC:  http://localhost:${PORT}`);
});
