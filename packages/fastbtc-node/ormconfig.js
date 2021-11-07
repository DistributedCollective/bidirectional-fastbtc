const {SnakeNamingStrategy} = require("typeorm-naming-strategies");
const {ALL_MODELS} = require("./dist/db/models");

module.exports = {
    type: "postgres",
    url: process.env['FASTBTC_DB_URL'],
    entities: ALL_MODELS,

    logging: false,
    namingStrategy: new SnakeNamingStrategy(),

    synchronize: false,
    migrations: ["dist/migration/*.js"],
    cli: {
        "migrationsDir": "src/migration"
    }
};
