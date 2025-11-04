/* server.js – backend Comparou Tá Barato
   Stack: Node + Express + PostgreSQL
   Executa no Render com PORT e DATABASE_URL
*/

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

// ===== Config de ambiente
const PORT = Number(process.env.PORT) || 8081;
const HOST = "0.0.0.0";

// Conexão Postgres
// Render fornece DATABASE_URL. Ative SSL sem validar CA.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida nas variáveis do serviço");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ===== App
const app = express();
app.use(cors());
app.use(express.json());

// ===== Login simples
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";
const activeTokens = new Set();

const genToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

app.post("/login", (req, res) => {
  const { user, pass } = req.body || {};
  if (String(user) === ADMIN_USER && String(pass) === ADMIN_PASS) {
    const token = genToken();
    activeTokens.add(token);
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ ok: false, error: "Credenciais inválidas" });
});

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

// ===== Healthcheck para o Render
app.get("/healthz", async (req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Inicialização do banco
async function ensureSchema() {
  const sql = `
    create table if not exists promotions (
      id serial primary key,
      product text not null,
      brand text,
      store text,
      price numeric(12,2) not null,
      unit text,
      category text,
      region text,
      updated_at timestamp not null default now()
    );
    create index if not exists idx_promotions_region on promotions(region);
    create index if not exists idx_promotions_product on promotions(product);
  `;
  await pool.query(sql);
}

// ===== Utilidades
function sanitizePromotion(p) {
  return {
    product: String(p.product || "").trim(),
    brand: String(p.brand || "").trim(),
    store: String(p.store || "").trim(),
    price: Number(p.price),
    unit: String(p.unit || "").trim(),
    category: String(p.category || "").trim(),
    region: String(p.region || "").trim(),
  };
}

function validPromotion(p) {
  return p.product && Number.isFinite(p.price);
}

// ===== Rotas CRUD
// Listagem com filtros opcionais ?region=...&q=...  q procura em product e brand
app.get("/promotions", async (req, res) => {
  try {
    const { region, q } = req.query;
    const where = [];
    const params = [];
    if (region && region !== "Todas") {
      params.push(String(region).toLowerCase());
      where.push("lower(region) = $" + params.length);
    }
    if (q) {
      params.push("%" + String(q).toLowerCase() + "%");
      where.push("(lower(product) like $" + params.length + " or lower(brand) like $" + params.length + ")");
    }
    const sql =
      "select id, product, brand, store, price::float8 as price, unit, category, region, updated_at from promotions" +
      (where.length ? " where " + where.join(" and ") : "") +
      " order by updated_at desc, id desc limit 500";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao listar promoções" });
  }
});

// Criar
app.post("/promotions", auth, async (req, res) => {
  try {
    const p = sanitizePromotion(req.body || {});
    if (!validPromotion(p)) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }
    const sql =
      "insert into promotions (product, brand, store, price, unit, category, region) values ($1,$2,$3,$4,$5,$6,$7) returning id, product, brand, store, price::float8 as price, unit, category, region, updated_at";
    const params = [p.product, p.brand, p.store, p.price, p.unit, p.category, p.region];
    const { rows } = await pool.query(sql, params);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar promoção" });
  }
});

// Atualizar
app.put("/promotions/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

    const p = sanitizePromotion(req.body || {});
    if (!validPromotion(p)) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }
    const sql =
      "update promotions set product=$1, brand=$2, store=$3, price=$4, unit=$5, category=$6, region=$7, updated_at=now() where id=$8 returning id, product, brand, store, price::float8 as price, unit, category, region, updated_at";
    const params = [p.product, p.brand, p.store, p.price, p.unit, p.category, p.region, id];
    const { rows } = await pool.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: "Registro não encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar promoção" });
  }
});

// Deletar
app.delete("/promotions/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

    const { rowCount } = await pool.query("delete from promotions where id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Registro não encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao remover promoção" });
  }
});

// ===== Front-end estático
app.use(express.static(path.join(__dirname, "public")));

// Qualquer rota não API devolve index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/promotions") || req.path.startsWith("/login") || req.path.startsWith("/healthz")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== Start
(async () => {
  try {
    await ensureSchema();
    app.listen(PORT, HOST, () => {
      console.log(`Servidor rodando em http://${HOST}:${PORT}`);
      console.log(`Abra no PC:  http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("Falha ao iniciar:", e);
    process.exit(1);
  }
})();
