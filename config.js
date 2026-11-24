// Default wallet configurations for new users in DinheirOS
module.exports = {
  maxUsers: 5,
  defaultWallets: [
    {
      name: 'Fare',
      weeklyAmount: 420,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 140,
      rollover: true
    },
    {
      name: 'Tokens',
      weeklyAmount: 180,
      dailyLimit: 1, // Max 1 withdrawal per day
      weeklyMaxCount: 3,
      perAccessAmount: 60,
      rollover: true
    },
    {
      name: 'Data',
      weeklyAmount: 100,
      dailyLimit: 0,
      weeklyMaxCount: 2,
      perAccessAmount: 50,
      rollover: true
    },
    {
      name: 'Meat',
      weeklyAmount: 450,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 150,
      rollover: true
    },
    {
      name: 'Betting',
      weeklyAmount: 100,
      dailyLimit: 0,
      weeklyMaxCount: 2,
      perAccessAmount: 50,
      rollover: true
    },
    {
      name: 'Energy',
      weeklyAmount: 180,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 60,
      rollover: true
    }
  ]
};
