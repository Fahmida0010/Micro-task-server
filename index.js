const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.DB_URI);

let usersCollection;
let tasksCollection;
let paymentsCollection;
let submissionsCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("taskDB");
  usersCollection = db.collection("users");
  tasksCollection = db.collection("tasks");
  paymentsCollection = db.collection("payments");
  submissionsCollection = db.collection("submissions");
  console.log("MongoDB Connected");
}
connectDB();


// JWT Middleware
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden" });
    req.user = decoded;
    next();
  });
};

// Users
app.post("/users", async (req, res) => {
  const user = req.body;
  const existing = await usersCollection.findOne({ email: user.email });
  if (existing) {
    return res.send({ success: false, message: "User already exists" });
  }
  await usersCollection.insertOne(user);
  res.send({ success: true });
});

app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});


// JWT
app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  res.send({ token });
});

// Buyer Stats
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


// Tasks
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


// Payments

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

// Submissions

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

// ======================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
