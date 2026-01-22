const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();

// ======================
// Middlewares
// ======================
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// ======================
// Test Route
// ======================
app.get("/", (req, res) => {
  res.send("Micro Task Server is running 🚀");
});

// ======================
// MongoDB Connection
// ======================
const client = new MongoClient(process.env.DB_URI);

let usersCollection;
let tasksCollection;
let paymentsCollection;
let submissionsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("Microtask");
    usersCollection = db.collection("users");
    tasksCollection = db.collection("tasks");
    paymentsCollection = db.collection("payments");
    submissionsCollection = db.collection("submissions");
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);
  }
}
connectDB();

// ======================
// JWT Middleware
// ======================
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden" });
    req.user = decoded;
    next();
  });
};

//users
app.post("/users", async (req, res) => {
  try {
    let { name, email, photo, role } = req.body;

    // normalize role (🔥 FIX)
    role = role.toLowerCase();

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.send({ success: false, message: "User already exists" });
    }

    let coin = 0;
    if (role === "worker") coin = 10;
    if (role === "buyer") coin = 50;

    const user = {
      name,
      email,
      photo,
      role,
      coin,
      createdAt: new Date(),
    };

    await usersCollection.insertOne(user);
    res.send({ success: true, user });
  } catch (error) {
    console.error("User creation error:", error);
    res.status(500).send({ success: false });
  }
});

// Get user info
app.get("/user/info", async (req, res) => {
  const email = req.query.email;
  const user = await db.collection("users").findOne({ email });
  if (!user) return res.status(404).send({ message: "User not found" });
  res.send({
    name: user.name,
    email: user.email,
    photo: user.photo,
    role: user.role,
    coin: user.coin || 0
  });
});



// ======================
// JWT
// ======================
app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  res.send({ token });
});

// ======================
// Buyer Stats
// ======================
app.get("/buyer/stats", verifyJWT, async (req, res) => {
  const totalTasks = await tasksCollection.countDocuments();
  const payments = await paymentsCollection.find().toArray();
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  res.send({
    totalTasks,
    pendingWorkers: 10,
    totalPaid,
  });
});

// ======================
// Tasks
// ======================
app.post("/tasks", verifyJWT, async (req, res) => {
  const task = { ...req.body, createdAt: new Date() };
  await tasksCollection.insertOne(task);
  res.send({ success: true });
});

app.get("/tasks/my", verifyJWT, async (req, res) => {
  const tasks = await tasksCollection.find().toArray();
  res.send(tasks);
});

app.delete("/tasks/:id", verifyJWT, async (req, res) => {
  await tasksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
  res.send({ success: true });
});

// ======================
// Payments
// ======================
app.post("/payments", verifyJWT, async (req, res) => {
  const payment = {
    ...req.body,
    amount: req.body.price,
    date: new Date(),
  };
  await paymentsCollection.insertOne(payment);
  res.send({ success: true });
});

app.get("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCollection.find().toArray();
  res.send(payments);
});

// ======================
// Submissions
// ======================
app.get("/submissions/pending", verifyJWT, async (req, res) => {
  const submissions = await submissionsCollection
    .find({ status: "pending" })
    .toArray();
  res.send(submissions);
});

app.patch("/submissions/approve/:id", verifyJWT, async (req, res) => {
  await submissionsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: "approved" } }
  );
  res.send({ success: true });
});

app.patch("/submissions/reject/:id", verifyJWT, async (req, res) => {
  await submissionsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: "rejected" } }
  );
  res.send({ success: true });
});



// Worker Stats//##
app.get("/worker/stats", async (req, res) => {
  const email = req.query.email;
  const submissions = await db
    .collection("submissions")
    .find({ worker_email: email })
    .toArray();

  const totalSubmissions = submissions.length;
  const totalPending = submissions.filter(s => s.status === "pending").length;
  const totalEarning = submissions
    .filter(s => s.status === "approved")
    .reduce((a, b) => a + b.payable_amount, 0);

  const approvedSubmissions = submissions.filter(s => s.status === "approved");

  res.send({ totalSubmissions, totalPending, totalEarning, approvedSubmissions });
});

// Tasks (available)
app.get("/tasks/available", async (req, res) => {
  const tasks = await db.collection("tasks").find({ required_workers: { $gt: 0 } }).toArray();
  res.send(tasks);
});

// Submit task
app.post("/submissions", async (req, res) => {
  const sub = req.body;
  await db.collection("submissions").insertOne(sub);

  // reduce required_workers
  await db.collection("tasks").updateOne(
    { _id: ObjectId(sub.task_id) },
    { $inc: { required_workers: -1 } }
  );

  res.send({ success: true });
});

// My submissions
app.get("/submissions/my", async (req, res) => {
  const email = req.query.email;
  const subs = await db.collection("submissions").find({ worker_email: email }).toArray();
  res.send(subs);
});

// Withdrawals
app.get("/worker/coin", async (req, res) => {
  const email = req.query.email;
  const user = await db.collection("users").findOne({ email });
  res.send({ coin: user?.coin || 0 });
});

app.post("/withdrawals", async (req, res) => {
  const data = req.body;
  await db.collection("withdrawals").insertOne(data);

  // decrease user coin
  await db.collection("users").updateOne(
    { email: data.worker_email },
    { $inc: { coin: -data.withdrawal_coin } }
  );

  res.send({ success: true });
});


// ======================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
