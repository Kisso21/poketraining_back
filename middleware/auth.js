import jwt from "jsonwebtoken";

export function verifyToken(req, res, next) {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token manquant" });
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

export function optionalToken(req, res, next) {
  const header = req.headers["authorization"];
  if (header?.startsWith("Bearer ")) {
    try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch {}
  }
  next();
}

export function verifyAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Accès refusé" });
    next();
  });
}

// Colonnes autorisées pour éviter l'injection SQL sur les noms de colonnes
const ALLOWED_BALL_COLUMNS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox"]);
const ALLOWED_ITEM_COLUMNS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox","pokedollars"]);


export function validateBallType(req, res, next) {
  const col = req.body.ballType || req.params.ballType;
  if (col && !ALLOWED_BALL_COLUMNS.has(col)) {
    return res.status(400).json({ error: "Type de ball invalide" });
  }
  next();
}

export function validateItemColumn(col) {
  return ALLOWED_ITEM_COLUMNS.has(col);
}

export { ALLOWED_BALL_COLUMNS, ALLOWED_ITEM_COLUMNS };
