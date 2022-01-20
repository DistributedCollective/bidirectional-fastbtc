import {inject, injectable} from "inversify";
import {Connection} from "typeorm";
import {LogItem} from "./models";
import {DBConnection} from "./connection";

@injectable()
export class DBLogging {
    constructor(@inject(DBConnection) private dbConnection: Connection) {

    }

    public async log(type: string, args = {}) {
        const repo = this.dbConnection.getRepository(LogItem);
        await repo.save(repo.create({
            type: type,
            data: args,
        }));
    }
}
