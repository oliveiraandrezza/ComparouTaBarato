// ===== Dependências =====
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

// ===== App =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== Config de Login =====
const ADMIN_USER = "admin";
const ADMIN_PASS = "1234"; // troque depois, se quiser
const activeTokens = new Set();
const genToken = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

// ===== Conexão MySQL (sua senha foi definida aqui) =====
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "12345",       // <--- SUA SENHA
  database: "comparou",
});

db.connect((err) => {
  if (err) {
    console.error("❌ Erro ao conectar ao MySQL:", err);
    process.exit(1);
  }
  console.log("✅ Conectado ao MySQL!");
});

// ===== Middleware de autenticação (aceita 'Bearer <token>') =====
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : h;
  if (token && activeTokens.has(token)) return next();
  return res.status(401).json({ error: "Não autorizado" });
}

// ===== Rotas de autenticação =====
app.post("/auth/login", (req, res) => {
  let { username, password } = req.body || {};
  username = (username || "").trim();
  password = (password || "").trim();
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = genToken();
    activeTokens.add(token);
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ error: "Credenciais inválidas" });
});

app.post("/auth/logout", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : h;
  if (token) activeTokens.delete(token);
  res.json({ ok: true });
});

// ✅ NOVO: verificar se o token ainda é válido (para restaurar sessão no front)
app.get("/auth/check", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : h;
  return res.json({ logged: token ? activeTokens.has(token) : false });
});

// ===== Rotas de dados =====
// GET público
app.get("/promotions", (req, res) => {
  const sql = `
    SELECT id, product, brand, store, price, unit, category, region, updated_at
    FROM promotions
    ORDER BY updated_at DESC, id DESC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: "Erro ao buscar dados" });
    res.json(results);
  });
});

// POST protegido
app.post("/promotions", auth, (req, res) => {
  const { product, brand, store, price, unit, category, region } = req.body || {};
  if (!product || !store || price === undefined || price === null || !unit || !category) {
    return res.status(400).json({ error: "Campos obrigatórios: product, store, price, unit, category" });
  }
  const sql = `
    INSERT INTO promotions (product, brand, store, price, unit, category, region, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
  db.query(sql, [product.trim(), brand||null, store.trim(), Number(price), unit.trim(), category.trim(), region||null], (err, result) => {
    if (err) return res.status(500).json({ error: "Erro ao inserir promoção" });
    res.status(201).json({ ok: true, id: result.insertId });
  });
});

// PUT protegido
app.put("/promotions/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  const { product, brand, store, price, unit, category, region } = req.body || {};
  if (!product || !store || price === undefined || price === null || !unit || !category) {
    return res.status(400).json({ error: "Campos obrigatórios: product, store, price, unit, category" });
  }

  const sql = `
    UPDATE promotions
       SET product=?, brand=?, store=?, price=?, unit=?, category=?, region=?, updated_at=NOW()
     WHERE id=?`;
  const params = [product.trim(), brand||null, store.trim(), Number(price), unit.trim(), category.trim(), region||null, id];

  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: "Erro ao atualizar promoção" });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Promoção não encontrada" });
    res.json({ ok: true, id });
  });
});

// DELETE protegido
app.delete("/promotions/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });
  db.query("DELETE FROM promotions WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: "Erro ao excluir promoção" });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Promoção não encontrada" });
    res.json({ ok: true, id });
  });
});

// ===== Servir o front-end estático =====
app.use(express.static(path.join(__dirname, "public"))); // backend/public/index.html

// ===== Start =====
const PORT = 8081;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`🔗 Abra no PC:  http://localhost:${PORT}`);
});
