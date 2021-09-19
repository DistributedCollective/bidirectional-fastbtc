import {SnakeNamingStrategy} from "typeorm-naming-strategies";
import {ALL_MODELS} from "./src/db/models";

export default {
    type: "postgres",
    url: process.env['FASTBTC_DB_URL'],
    entities: ALL_MODELS,

    logging: false,
    namingStrategy: new SnakeNamingStrategy(),

    // TODO: should be false in prod! and have real migrations
    synchronize: false,
};
