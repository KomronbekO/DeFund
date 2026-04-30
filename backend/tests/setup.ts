process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:./test-${process.pid}.db`;
process.env.LOG_LEVEL = 'silent';
