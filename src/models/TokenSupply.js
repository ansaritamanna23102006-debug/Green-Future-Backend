import mongoose from "mongoose";

const tokenSupplySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global_supply",
      unique: true,
    },
    totalSupply: {
      type: Number,
      default: 1000000000, // 100 Crore
      required: true,
    },
    availableSupply: {
      type: Number,
      default: 1000000000,
      required: true,
    },
    reservedTokens: {
      type: Number,
      default: 0,
      required: true,
    },
    distributedBonuses: {
      type: Number,
      default: 0,
      required: true,
    },
    returnedTokens: {
      type: Number,
      default: 0,
      required: true,
    },
    totalWithdrawalsINR: {
      type: Number,
      default: 0,
    },
    totalWithdrawalsUSDT: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const TokenSupply = mongoose.model("TokenSupply", tokenSupplySchema);
export default TokenSupply;
