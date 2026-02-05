const crypto = require("crypto"); 
const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CLIENT_URL = process.env.CLIENT_URL;


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
    withdrawalsCollection = db.collection("withdrawals");


    console.log("MongoDB Connected Successfully ");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);
  }
}

connectDB();


// JWT Middleware 
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
// GET /buyer/stats/:email
// ======================
app.get("/buyer/stats/:email", verifyJWT, async (req, res) => {
  try {
    const requestedEmail = req.params.email;
    const decodedEmail = req.decoded.email;
    if (requestedEmail !== decodedEmail) {
      return res.status(403).json({ message: "You can only access your own stats" });
    }

    const buyer = await usersCollection.findOne({ email: requestedEmail });
    if (!buyer) {
      return res.status(404).json({ message: "Buyer not found" });
    }
    const totalTasks = await tasksCollection.countDocuments({
      Buyer_email: requestedEmail
    });
    const pendingWorkers = await submissionsCollection.countDocuments({
      Buyer_email: requestedEmail,
      status: "pending"
    });
    const totalPaidAgg = await submissionsCollection.aggregate([
      {
        $match: {
          Buyer_email: requestedEmail,
          status: "approved"
        }
      },
      {
        $group: { _id: null, total: { $sum: "$payable_amount" } }
      }
    ]).toArray();

    const totalPaid = totalPaidAgg[0]?.total || 0;

    res.json({
      totalTasks,
      pendingWorkers,
      totalPaid
    });
  } catch (err) {
    console.error("Buyer stats error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Buyer all submissions (pending + approved + rejected)
app.get("/submissions/buyer/:email", verifyJWT, async (req, res) => {
  try {
    const requestedEmail = req.params.email;
    const decodedEmail = req.decoded.email;

    if (requestedEmail !== decodedEmail) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const submissions = await submissionsCollection
      .find({ Buyer_email: requestedEmail })
      .sort({ submittedAt: -1 }) 
      .toArray();

    res.json(submissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

  // PATCH /submissions/approve/:id
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

  // PATCH /submissions/reject/:id
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


// AddTask API
app.post("/tasks", verifyJWT, async (req, res) => {
  try {
    const task = req.body;
    const buyerEmail = task.Buyer_email;

    // 1️⃣ Find buyer by email
    const buyer = await usersCollection.findOne({ email: buyerEmail });
    if (!buyer) {
      return res.status(404).json({ message: "Buyer not found" });
    }

    // 2️⃣ Calculate total payable amount
    const totalPay = task.required_workers * task.payable_amount;

    // 3️⃣ Check buyer coin balance
    if (totalPay > buyer.coin) {
      // Don't send alert or navigate here
      // Just return status 400 + message
      return res.status(400).json({ message: "Not enough coins,Purchase coins!" });
    }

    // console.log("Buyer email:", buyerEmail);

    // 4️⃣ Deduct coins from buyer
    await usersCollection.updateOne(
      { email:buyerEmail},
      { $inc: { coin: -totalPay } }
    );

    // 5️⃣ Save task
    const result = await tasksCollection.insertOne({
      ...task,
      totalPay,
      status: "active",
      createdAt: new Date(),
    });

    // 6️⃣ Success response
    res.status(201).json({
      message: "Task added successfully!",
      taskId: result.insertedId,
    });

  } catch (error) {
    console.error("ADD TASK ERROR:", error);
    res.status(500).json({ message: "Failed to add task!" });
  }
});


  // GET /tasks/my/buyer 
app.get("/tasks/my", verifyJWT, async (req, res) => {
  try {
    const buyerEmail = req.decoded.email;

    const myTasks = await tasksCollection
      .find({ Buyer_email: buyerEmail })
      .toArray();

    res.json(myTasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
});

  // DELETE /mytasks/:id/buyer
app.delete("/tasks/:id", verifyJWT, async (req, res) => {
  try {
    const taskId = req.params.id;
    const buyerEmail = req.decoded.email;

    const task = await tasksCollection.findOne({
      _id: new ObjectId(taskId)
    });

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (task.Buyer_email !== buyerEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await tasksCollection.deleteOne({ _id: new ObjectId(taskId) });

    res.json({ message: "Task deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete task" });
  }
});



  // ================= CREATE CHECKOUT SESSION ==================
app.post("/create-checkout-session", verifyJWT, async (req, res) => {
  const { userEmail, coin, price } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${coin} Coins Package`,
            },
            unit_amount: price * 100, 
          },
          quantity: 1,
        },
      ],
      success_url: `${CLIENT_URL}/payment-success?userEmail=${userEmail}&coin=${coin}`,
      cancel_url: `${CLIENT_URL}/payment-failed`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Stripe session creation failed" });
  }
});

// ================= PATCH USER COINS BY EMAIL ==================
app.patch("/users/coins/:email", verifyJWT, async (req, res) => {
  const { email, coins } = req.body;

  if (!email || !coins || isNaN(coins) || Number(coins) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid email and positive coins amount required",
    });
  }

  try {
    const result = await usersCollection.updateOne(
      { email: email.toLowerCase().trim() },     // normalize email
      { $inc: { coin: Number(coins) } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email",
      });
    }

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `${coins} coins added`,
    });
  } catch (err) {
    console.error("Error updating coins:", err);
    res.status(500).json({
      success: false,
      message: "Server error while updating coins",
    });
  }
});

// Save payment
app.post("/payments", verifyJWT, async (req, res) => {
  const { email, coins, amount } = req.body;

  if (!email || !coins || !amount) {
    return res.status(400).send({ message: "Missing payment info" });
  }

  try {
    const transactionId = crypto.randomBytes(8).toString("hex");

    const paymentData = {
      transactionId,                     
      email: email.toLowerCase().trim(),
      coins: Number(coins),
      amount: Number(amount),
      date: new Date(),
    };
    const result = await paymentsCollection.insertOne(paymentData);

    res.send({
      success: true,
      insertedId: result.insertedId,
      transactionId,                      // return it to frontend if needed
    });
  } catch (err) {
    console.error("Payment save error:", err);
    res.status(500).send({ message: "Failed to save payment" });
  }
});

 //find payment history 
app.get("/payments/:email", verifyJWT, async (req, res) => {
  const email = req.params.email.toLowerCase().trim();

  try {
    const payments = await paymentsCollection
      .find({ email })
      .sort({ date: -1 })
      .toArray();

    res.send(payments);
  } catch (err) {
    console.error("Fetch payment history error:", err);
    res.status(500).send({ message: "Failed to fetch payments" });
  }
});

   //workerhome//
app.get("/worker-stats/:email", async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const submissions = await submissionsCollection
      .find({ worker_email: email })
      .toArray();

    const approved = submissions.filter((sub) => sub.status === "approved");
    const pending = submissions.filter((sub) => sub.status === "pending");

    const totalEarning = approved.reduce(
      (sum, item) => sum + Number(item.payable_amount || 0),
      0
    );

    res.send({
      totalSubmissions: submissions.length,
      totalPending: pending.length,
      totalEarning,
      approvedSubmissions: approved,
    });
  } catch (error) {
    console.error("Worker stats error:", error);
    res.status(500).send({ message: "Server error", error: error.message });
  }
});

 // ================= TASK LIST (active tasks) =================
app.get("/tasks", async (req, res) => {
  try {
    const tasks = await tasksCollection
      .find({ status: "active" })
      .toArray();

    res.send(tasks);

  } catch (error) {
    res.status(500).send({ message: "Failed to load tasks", error });
  }
});

// ================= SINGLE TASK (TaskDetails page) =================
app.get("/tasks/:id", async (req, res) => {
  try {

    const id = req.params.id;

    const task = await tasksCollection.findOne({
      _id: new ObjectId(id)
    });

    if (!task) {
      return res.status(404).send({ message: "Task not found" });
    }

    res.send(task);

  } catch (error) {
    res.status(500).send({ message: "Failed to load task", error });
  }
});
app.post("/task-submit", async (req, res) => {

  try {

    const submission = req.body;

    // Save submission
    await submissionsCollection.insertOne(submission);

    // Reduce worker count safely (never below 0)
    await tasksCollection.updateOne(
      { _id: new ObjectId(submission.task_id) },
      { 
        $inc: { required_workers: -1 } 
      }
    );

    res.send({ message: "Task submitted successfully" });

  } catch (error) {

    res.status(500).send({ message: "Submission failed", error });

  }
});


//  //my-submissions
// app.get("/my-submissions/:email", async (req, res) => {
//   try {
//     const email = req.params.email;

//     const submissions = await submissionsCollection
//       .find({ worker_email: email })
//       .sort({ current_date: -1 }) 
//       .toArray();

//     res.send(submissions);

//   } catch (error) {
//     res.status(500).send({ message: "Failed to fetch submissions", error });
//   }
// });
// GET submissions by worker email with pagination
app.get("/my-submissions/:email", async (req, res) => {
  const workerEmail = req.params.email;
  const page = parseInt(req.query.page) || 1; // default page 1
  const limit = parseInt(req.query.limit) || 5; // default 5 per page
  const skip = (page - 1) * limit;

  try {
    const total = await submissionsCollection.countDocuments({ worker_email: workerEmail });

    const submissions = await submissionsCollection
      .find({ worker_email: workerEmail })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({
      submissions,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch submissions", err });
  }
});



  //worker coin get api//
app.get("/worker-coin/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const worker = await usersCollection.findOne({ email });

    res.send({
      coin: worker?.coin || 0
    });

  } catch (error) {
    res.status(500).send({ message: "Failed to get coin", error });
  }
});

  //worker coin withdrawls //
app.post("/withdraw", async (req, res) => {
  try {
    const withdrawData = req.body;
    await withdrawalsCollection.insertOne(withdrawData);
    // decrease worker coin
    await usersCollection.updateOne(
      { email: withdrawData.worker_email },
      { $inc: { coin: -withdrawData.withdrawal_coin } }
    );
    res.send({ message: "Withdrawal requested successfully" });

  } catch (error) {
    res.status(500).send({ message: "Withdraw failed", error });
  }
});



    // ================= ADMIN STATS =================
    app.get("/admin-stats", async (req, res) => {
      try {
        const workers = await usersCollection.countDocuments({ role: "worker" });
        const buyers = await usersCollection.countDocuments({ role: "buyer" });

        const coinResult = await usersCollection.aggregate([
          { $group: { _id: null, total: { $sum: "$coin" } } }
        ]).toArray();

        const totalCoin = coinResult[0]?.total || 0;

        const paymentResult = await paymentsCollection.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]).toArray();

        const totalPayments = paymentResult[0]?.total || 0;

        res.send({
          workers,
          buyers,
          totalCoin,
          totalPayments
        });

      } catch (err) {
        res.status(500).send({ message: "Admin stats error", err });
      }
    });


    // ================= WITHDRAW REQUEST =================
    app.get("/withdraw-requests", async (req, res) => {
      try {
        const result = await withdrawalsCollection
          .find({ status: "pending" })
          .toArray();

        res.send(result);

      } catch (err) {
        res.status(500).send({ message: "Withdraw fetch error", err });
      }
    });


    // ================= admin APPROVE WITHDRAW =================
    app.patch("/withdraw-approve/:id", async (req, res) => {

      const { id } = req.params;
      const { email, coin } = req.body;

      try {

        // deduct worker coin
        await usersCollection.updateOne(
          { email: email },
          { $inc: { coin: -coin } }
        );

        // update withdraw status
        const result = await withdrawalsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved" } }
        );

        res.send(result);

      } catch (err) {
        res.status(500).send({ message: "Approve error", err });
      }
    });


    // ================= GET ALL USERS =================
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ message: "Failed to load users", err });
      }
    });


    // ================= DELETE USER =================
    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed", err });
      }
    });


    // ================= UPDATE ROLE =================
    app.patch("/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: role } }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Role update failed", err });
      }
    });


    // ================= GET ALL TASKS (with buyer info) =================
    app.get("/tasks", async (req, res) => {
      try {
        const tasks = await tasksCollection.find().toArray();

        // add buyer name & email
        const formatted = await Promise.all(
          tasks.map(async (task) => {

            const buyer = await usersCollection.findOne({
              email: task.buyer_email
            });

            return {
              ...task,
              buyer_name: buyer?.name || "Unknown",
              buyer_email: buyer?.email || "N/A"
            };
          })
        );

        res.send(formatted);

      } catch (err) {
        res.status(500).send({ message: "Tasks load error", err });
      }
    });


   // ============ DELETE TASK BY EMAIL ============

app.delete("/tasks/by-email/:email", verifyJWT, async (req, res) => {
  const email = req.params.email;

  try {
    const result = await tasksCollection.deleteOne({
      Buyer_email: email
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "No task found for this email" });
    }

    res.send({
      success: true,
      message: "Task deleted successfully",
      result
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Delete failed",
      error
    });
  }
});

// ======================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
