export default () => ({
  database: {
    mongodb: {
      url: process.env.MONGODB_CONNECTION_URL,
    },
  },
});
