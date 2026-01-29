const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();

//middleware
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

let db;
let usersCollection;
let tasksCollection;
let paymentsCollection;
let submissionsCollection;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("Microtask");

    usersCollection = db.collection("users");
    tasksCollection = db.collection("tasks");
    paymentsCollection = db.collection("payments");
    submissionsCollection = db.collection("submissions");

    console.log("MongoDB Connected Successfully ");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);
  }
}

connectDB();


// JWT Middleware (Updated for Stability)
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access: No token found" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log("JWT Error:", err.message); // এরর কি হচ্ছে কনসোলে দেখার জন্য
      return res.status(401).send({ message: "Unauthorized access: Invalid token" });
    }

    req.decoded = decoded; 
    next();
  });
};

//users
app.post("/users", async (req, res) => {
  try {
    let { name, email, photo, role } = req.body;

    // normalize role
    role = role.toLowerCase();

    // check existing user
    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      return res.send({
        success: true,
        user: existingUser,
        message: "User already exists"
      });
    }

    // coin logic
    const coin = role === "worker" ? 10 : 50;

    const user = {
      name,
      email,
      photo,
      role,
      coin,
      createdAt: new Date(),
    };

    await usersCollection.insertOne(user);

    res.send({
      success: true,
      user
    });

  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).send({ success: false });
  }
});
// user info
app.get("/user/info", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send({ message: "Email required" });
  }

  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(404).send({ message: "User not found" });
  }

  res.send({
    coin: user.coin,
    role: user.role,
  });
});

app.get("/users/:email", verifyJWT, async (req, res) => {

  const email = req.params.email;

  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "Forbidden" });
  }

  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(404).send({ message: "User not found" });
  }

  res.send(user);
});

//jwt
app.post("/jwt", (req, res) => {
  const user = req.body;
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, {
     expiresIn: "365d", 
  });
  res.send({ token });
});

  // ======================
  // GET /buyer/stats
  // ======================
  app.get("/buyer/stats", verifyJWT, async (req, res) => {
    try {
      const buyerEmail = req.decoded.email;
      const buyer = await usersCollection.findOne({ email: buyerEmail });
      if (!buyer) return res.status(404).json({ message: "Buyer not found" });

      const totalTasks = await tasksCollection.countDocuments({ buyerId: buyer._id.toString() });
      const pendingWorkers = await submissionsCollection.countDocuments({ buyerId: buyer._id.toString(), status: "pending" });

      const totalPaidAgg = await submissionsCollection.aggregate([
        { $match: { buyerId: buyer._id.toString(), status: "approved" } },
        { $group: { _id: null, total: { $sum: "$payable_amount" } } }
      ]).toArray();

      const totalPaid = totalPaidAgg[0]?.total || 0;

      res.json({ totalTasks, pendingWorkers, totalPaid });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // ======================
  // GET /submissions/pending
  // ======================
  app.get("/submissions/pending", verifyJWT, async (req, res) => {
    try {
      const buyerEmail = req.decoded.email;
      const buyer = await usersCollection.findOne({ email: buyerEmail });
      if (!buyer) return res.status(404).json({ message: "Buyer not found" });

      const pendingSubs = await submissionsCollection.find({ buyerId: buyer._id.toString(), status: "pending" }).toArray();
      res.json(pendingSubs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch pending submissions" });
    }
  });

  // ======================
  // PATCH /submissions/approve/:id
  // ======================
  app.patch("/submissions/approve/:id", verifyJWT, async (req, res) => {
    try {
      const subId = req.params.id;
      const submission = await submissionsCollection.findOne({ _id: new ObjectId(subId) });
      if (!submission) return res.status(404).json({ message: "Submission not found" });

      await submissionsCollection.updateOne(
        { _id: new ObjectId(subId) },
        { $set: { status: "approved", approvedAt: new Date() } }
      );

      res.json({ message: "Submission approved successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to approve submission" });
    }
  });

  // ======================
  // PATCH /submissions/reject/:id
  // ======================
  app.patch("/submissions/reject/:id", verifyJWT, async (req, res) => {
    try {
      const subId = req.params.id;
      const submission = await submissionsCollection.findOne({ _id: new ObjectId(subId) });
      if (!submission) return res.status(404).json({ message: "Submission not found" });

      await submissionsCollection.updateOne(
        { _id: new ObjectId(subId) },
        { $set: { status: "rejected", rejectedAt: new Date() } }
      );

      res.json({ message: "Submission rejected successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to reject submission" });
    }
  });


// Add this inside your Express app, after connecting to MongoDB//
app.post("/tasks", verifyJWT, async (req, res) => {
  // console.log(req.body)
  try {
    const task = req.body;
    const buyerId = task.buyerId;

    // 1️⃣ Find the buyer in DB
    const buyer = await usersCollection.findOne({ _id: new ObjectId(buyerId) });
    if (!buyer) return res.status(404).json({ message: "Buyer not found" });

    // 2️⃣ Calculate total payable amount
    const totalPay = task.required_workers * task.payable_amount;

    // 3️⃣ Check if buyer has enough coins
    if (totalPay > buyer.coin) {
      return res.status(400).json({ message: "Not enough coins" });
    }

    // 4️⃣ Reduce buyer coins
    await usersCollection.updateOne(
      { _id: new ObjectId(buyerId) },
      { $inc: {coin: -totalPay } }
    );

    // 5️⃣ Save the task in tasks collection
    const result = await tasksCollection.insertOne({
      ...task,
      totalPay,
      createdAt: new Date(),
    });

    // 6️⃣ Respond success
    res.status(201).json({ message: "Task added successfully!", taskId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add task!" });
  }
});


  // ======================
  // GET /tasks/my
  // ======================
  app.get("/tasks/my", verifyJWT, async (req, res) => {
    try {
      const buyerEmail = req.decoded.email;
      const buyer = await usersCollection.findOne({ email: buyerEmail });
      if (!buyer) return res.status(404).json({ message: "Buyer not found" });

      const myTasks = await tasksCollection
        .find({ buyerId: buyer._id.toString() })
        .toArray();

      res.json(myTasks);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // ======================
  // DELETE /tasks/:id
  // ======================
  app.delete("/tasks/:id", verifyJWT, async (req, res) => {
    try {
      const taskId = req.params.id;
      const buyerEmail = req.decoded.email;
      const buyer = await usersCollection.findOne({ email: buyerEmail });
      if (!buyer) return res.status(404).json({ message: "Buyer not found" });

      const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) });
      if (!task) return res.status(404).json({ message: "Task not found" });

      if (task.buyerId !== buyer._id.toString())
        return res.status(403).json({ message: "Forbidden" });

      await tasksCollection.deleteOne({ _id: new ObjectId(taskId) });
      res.json({ message: "Task deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });



  // ======================
  // PATCH /users/:id/coins
  // ======================
  app.patch("/users/:id/coins", verifyJWT, async (req, res) => {
    try {
      const userId = req.params.id;
      const { coins } = req.body;

      // check JWT user matches param
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.email !== req.decoded.email)
        return res.status(403).json({ message: "Forbidden" });

      // add coins
      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { coin: coins } }
      );

      res.json({ message: `Successfully added ${coins} coins` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add coins" });
    }
  });


  // ======================
  // GET /payments/:buyerId
  // ======================
  app.get("/payments/:buyerId", verifyJWT, async (req, res) => {
    try {
      const buyerId = req.params.buyerId;

      // check JWT user matches param
      const payments = await paymentsCollection
        .find({ buyerId: new ObjectId(buyerId) })
        .sort({ date: -1 })
        .toArray();

      res.json(payments);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

   //workerhome//
app.get("/worker-stats/:email", async (req, res) => {
  try {
    const email = req.params.email;

    // All submissions by this worker
    const submissions = await submissionsCollection.find({ worker_email: email }).toArray();

    // Approved submissions
    const approved = submissions.filter(sub => sub.status === "approved");

    // Pending submissions
    const pending = submissions.filter(sub => sub.status === "pending");

    // Total earnings
    const totalEarning = approved.reduce(
      (sum, item) => sum + Number(item.payable_amount),
      0
    );

    res.send({
      totalSubmissions: submissions.length,
      totalPending: pending.length,
      totalEarning,
      approvedSubmissions: approved
    });

  } catch (error) {
    res.status(500).send({ message: "Server error", error });
  }
});

  //my-submissions
app.get("/my-submissions/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const submissions = await submissionsCollection
      .find({ worker_email: email })
      .sort({ date: -1 }) // latest first
      .toArray();

    res.send(submissions);

  } catch (error) {
    res.status(500).send({ message: "Failed to fetch submissions", error });
  }
});






// ======================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
