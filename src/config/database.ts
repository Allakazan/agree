export default () => ({
  database: {
    postgresql: {
      url: process.env.DATABASE_URL,
    },
    mongodb: {
      url: process.env.MONGODB_URI,
    },
  },
});
