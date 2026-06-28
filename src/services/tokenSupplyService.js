import TokenSupply from "../models/TokenSupply.js";

class TokenSupplyService {
  async getSupply() {
    let supply = await TokenSupply.findOne({ key: "global_supply" });
    if (!supply) {
      supply = await TokenSupply.create({
        key: "global_supply",
        totalSupply: 1000000000,
        availableSupply: 1000000000,
        reservedTokens: 0,
        distributedBonuses: 0,
        returnedTokens: 0,
        totalWithdrawalsINR: 0,
        totalWithdrawalsUSDT: 0,
      });
    }
    return supply;
  }

  async reserveTokens(amount) {
    const supply = await this.getSupply();
    if (supply.availableSupply < amount) {
      throw new Error("Insufficient GFT token supply available for reservation");
    }
    supply.availableSupply -= amount;
    supply.reservedTokens += amount;
    await supply.save();
    return supply;
  }

  async returnTokens(amount) {
    const supply = await this.getSupply();
    supply.reservedTokens = Math.max(0, supply.reservedTokens - amount);
    supply.availableSupply += amount;
    supply.returnedTokens += amount;
    await supply.save();
    return supply;
  }

  async distributeBonus(amount) {
    const supply = await this.getSupply();
    if (supply.availableSupply < amount) {
      // If available supply is low, distribute what is left or throw error depending on requirements.
      // We will decrease available supply and add to distributed.
      amount = Math.min(amount, supply.availableSupply);
    }
    supply.availableSupply -= amount;
    supply.distributedBonuses += amount;
    await supply.save();
    return supply;
  }

  async recordWithdrawal(amount, currency) {
    const supply = await this.getSupply();
    if (currency.toUpperCase() === "INR") {
      supply.totalWithdrawalsINR += amount;
    } else {
      supply.totalWithdrawalsUSDT += amount;
    }
    await supply.save();
    return supply;
  }
}

export default new TokenSupplyService();
