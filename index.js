const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jasper2plusodds-default-rtdb.firebaseio.com"
});

const db = admin.database();

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

app.get("/send-daily", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const timestamp = Date.now();

  const tips = {
    match_001: {
      date: today,
      league: "England Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      tip: "Over 1.5",
      odd: "1.55",
      time: "06:00",
      status: "pending",
      createdAt: timestamp
    },
    match_002: {
      date: today,
      league: "Spain La Liga",
      homeTeam: "Barcelona",
      awayTeam: "Sevilla",
      tip: "Home Win",
      odd: "1.60",
      time: "06:00",
      status: "pending",
      createdAt: timestamp
    },
    match_003: {
      date: today,
      league: "Germany Bundesliga",
      homeTeam: "Bayern",
      awayTeam: "Mainz",
      tip: "Home Over 1.5",
      odd: "1.40",
      time: "06:00",
      status: "pending",
      createdAt: timestamp
    }
  };

  await db.ref(`jasper2plusodds/dailyTips/today`).set(tips);

  res.send("Daily tips sent successfully ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
