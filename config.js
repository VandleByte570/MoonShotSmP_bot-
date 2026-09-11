require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const falixKey = process.env.FALIX_API_KEY;
const serverId = process.env.FALIX_SERVER_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN is missing in .env");
}

if (!falixKey) {
  throw new Error("FALIX_API_KEY is missing in .env");
}

if (!serverId) {
  throw new Error("FALIX_SERVER_ID is missing in .env");
}

module.exports = {
  token,
  falixKey,
  serverId
};
