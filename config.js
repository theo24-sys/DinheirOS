// Default wallet configurations for new users in DinheirOS
module.exports = {
  maxUsers: 5,
  defaultWallets: [
    {
      name: 'Food',
      weeklyAmount: 780,
      dailyLimit: 0,
      weeklyMaxCount: 4,
      perAccessAmount: 195,
      rollover: true
    },
    {
      name: 'Kplc',
      weeklyAmount: 250,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 83,
      rollover: true
    },
    {
      name: 'Stake',
      weeklyAmount: 150,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 50,
      rollover: true
    },
    {
      name: 'Fare',
      weeklyAmount: 150,
      dailyLimit: 0,
      weeklyMaxCount: 3,
      perAccessAmount: 50,
      rollover: true
    },
    {
      name: 'Data',
      weeklyAmount: 100,
      dailyLimit: 0,
      weeklyMaxCount: 5,
      perAccessAmount: 20,
      rollover: true
    }
  ]
};
