const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// Настройка PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'sigma_db',
  password: 'postgres',
  port: 5432,
});

// Настройка EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'sigma-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session.userId && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// Передача данных пользователя в шаблоны
app.use((req, res, next) => {
  res.locals.user = req.session.userId ? { id: req.session.userId, name: req.session.userName, isAdmin: req.session.isAdmin } : null;
  next();
});

// ========== БАЗА ДАННЫХ ==========
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      phone VARCHAR(20),
      password VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      product_name VARCHAR(200) NOT NULL,
      volume VARCHAR(50),
      quantity INTEGER DEFAULT 1,
      price_per_unit DECIMAL(10,2),
      total_price DECIMAL(10,2),
      status VARCHAR(50) DEFAULT 'Новый',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(100),
      price DECIMAL(10,2),
      volume_options TEXT,
      description TEXT,
      image_url VARCHAR(300),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Админ по умолчанию
  const adminCheck = await pool.query("SELECT * FROM users WHERE email = 'admin@sigma.ru'");
  if (adminCheck.rows.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query("INSERT INTO users (name, email, password, is_admin) VALUES ($1,$2,$3,$4)",
      ['Администратор', 'admin@sigma.ru', hash, true]);
  }

  // Продукты по умолчанию
  const prodCheck = await pool.query("SELECT COUNT(*) FROM products");
  if (prodCheck.rows[0].count == 0) {
    const defaultProducts = [
      ['Корона изобилия', 'Фасованное масло', 95, '0.5л, 1л, 1.7л, 3л, 5л', 'Премиум-масло первого холодного отжима', '/img/image 19.png'],
      ['Золотая капелька', 'Фасованное масло', 78, '0.87л, 0.97л, 1л, 3л, 5л', 'Рафинированное масло высшего сорта', '/img/image 21.png'],
      ['Семь подсолнухов', 'Фасованное масло', 82, '0.87л, 0.97л, 1л, 2л, 5л', 'Нерафинированное масло высшего сорта', '/img/image 20.png'],
      ['Золото Оренбуржья', 'Фасованное масло', 105, '1л', 'Элитное масло из отборных семян', '/img/image 22.png'],
      ['Чишминское халяль', 'Фасованное масло', 88, '1л', 'Сертифицированное халяль масло', '/img/image 24.png'],
      ['Солнечный цветок', 'Фасованное масло', 75, '0.87л, 4.7л, 5л', 'Рафинированное масло первого сорта', '/img/image 23.png'],
      ['Шрот', 'Продукты переработки', 18000, 'тонна', 'Высокобелковый кормовой продукт', '/img/image 15.png'],
      ['Лузга', 'Продукты переработки', 3500, 'тонна', 'Шелуха подсолнечника для топлива', '/img/image 16.png'],
      ['Соапсток', 'Продукты переработки', 22000, 'тонна', 'Побочный продукт рафинации', '/img/image 17.png']
    ];
    for (const p of defaultProducts) {
      await pool.query("INSERT INTO products (name, category, price, volume_options, description, image_url) VALUES ($1,$2,$3,$4,$5,$6)", p);
    }
  }
  console.log('База данных готова');
}

// ========== ГЛАВНЫЕ СТРАНИЦЫ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'главная.html')));
app.get('/продукция', (req, res) => res.sendFile(path.join(__dirname, 'public', 'продукция.html')));
app.get('/доставка', (req, res) => res.sendFile(path.join(__dirname, 'public', 'доставка.html')));
app.get('/контакты', (req, res) => res.sendFile(path.join(__dirname, 'public', 'контакты.html')));

// ========== АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ==========
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.render('login', { error: 'Пользователь не найден' });
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.render('login', { error: 'Неверный пароль' });

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.isAdmin = user.is_admin;
    res.redirect('/dashboard');
  } catch (err) {
    res.render('login', { error: 'Ошибка сервера' });
  }
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { name, email, phone, password, password2 } = req.body;
  if (password !== password2) return res.render('register', { error: 'Пароли не совпадают' });
  
  try {
    const exist = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (exist.rows.length > 0) return res.render('register', { error: 'Email уже занят' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, phone, password) VALUES ($1,$2,$3,$4) RETURNING id, name",
      [name, email, phone, hash]
    );
    req.session.userId = result.rows[0].id;
    req.session.userName = result.rows[0].name;
    req.session.isAdmin = false;
    res.redirect('/dashboard');
  } catch (err) {
    res.render('register', { error: 'Ошибка сервера' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ========== ЛИЧНЫЙ КАБИНЕТ ==========
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const orders = await pool.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.userId]
    );
    res.render('dashboard', { user: { id: req.session.userId, name: req.session.userName }, orders: orders.rows });
  } catch (err) {
    res.render('dashboard', { user: { id: req.session.userId, name: req.session.userName }, orders: [] });
  }
});

// ========== ОФОРМЛЕНИЕ ЗАКАЗА ==========
app.get('/order', requireAuth, async (req, res) => {
  try {
    const products = await pool.query("SELECT * FROM products ORDER BY category, name");
    res.render('order', { products: products.rows });
  } catch (err) {
    res.render('order', { products: [] });
  }
});

app.post('/order', requireAuth, async (req, res) => {
  const { product_id, volume, quantity } = req.body;
  try {
    const product = await pool.query("SELECT * FROM products WHERE id = $1", [product_id]);
    if (product.rows.length === 0) return res.redirect('/order');
    
    const p = product.rows[0];
    const total = p.price * parseInt(quantity);
    await pool.query(
      "INSERT INTO orders (user_id, product_name, volume, quantity, price_per_unit, total_price) VALUES ($1,$2,$3,$4,$5,$6)",
      [req.session.userId, p.name, volume, quantity, p.price, total]
    );
    res.redirect('/dashboard');
  } catch (err) {
    res.redirect('/order');
  }
});

// ========== АДМИН-ПАНЕЛЬ ==========
app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND is_admin = true", [email]);
    if (result.rows.length === 0) return res.render('admin-login', { error: 'Доступ запрещён' });
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.render('admin-login', { error: 'Неверный пароль' });

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.isAdmin = true;
    res.redirect('/admin');
  } catch (err) {
    res.render('admin-login', { error: 'Ошибка сервера' });
  }
});

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const orders = await pool.query(`
      SELECT o.*, u.name as user_name, u.email as user_email 
      FROM orders o JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC
    `);
    const products = await pool.query("SELECT * FROM products ORDER BY category, name");
    const users = await pool.query("SELECT * FROM users WHERE is_admin = false ORDER BY created_at DESC");
    res.render('admin', { orders: orders.rows, products: products.rows, users: users.rows });
  } catch (err) {
    res.render('admin', { orders: [], products: [], users: [] });
  }
});

app.post('/admin/product/add', requireAdmin, async (req, res) => {
  const { name, category, price, volume_options, description, image_url } = req.body;
  await pool.query(
    "INSERT INTO products (name, category, price, volume_options, description, image_url) VALUES ($1,$2,$3,$4,$5,$6)",
    [name, category, price, volume_options, description, image_url || '/img/default.png']
  );
  res.redirect('/admin');
});

app.post('/admin/order/status', requireAdmin, async (req, res) => {
  const { order_id, status } = req.body;
  await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, order_id]);
  res.redirect('/admin');
});

// Запуск
const PORT = 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
});