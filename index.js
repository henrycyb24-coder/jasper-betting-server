const express = require("express");
const cron = require("node-cron");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Jasper Betting Server Running 🚀");
});

cron.schedule("0 6 * * *", () => {
  console.log("6AM Job Running...");
});

app.listen(3000, () => {
  console.log("Server started on port 3000");
});
