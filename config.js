require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const falixKey = process.env.FALIX_API_KEY;
const serverId = process.env.FALIX_SERVER_ID;

module.exports = {
  token,
  falixKey,
  serverId
};
