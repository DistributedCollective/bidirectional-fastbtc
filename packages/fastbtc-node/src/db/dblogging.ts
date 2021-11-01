import {injectable} from "inversify";
import {Connection} from "typeorm";
import {LogItem} from "./models";
import {p2data} from "bitcoinjs-lib/types/payments/embed";

@injectable()
export class DBLogging {
    private connection: Connection;
    constructor(connection: Connection) {
        this.connection = connection;
    }

    async log(type: string, args = {}) {
        const repo = this.connection.getRepository(LogItem);
        await repo.save(repo.create({
            type: type,
            data: args,
        }));
    }
}
