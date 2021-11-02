import { Network } from '../Network';
import { SharedGroup } from './SharedGroup';
/**
 * Manager for all group instances that a node is a member of.
 */
export declare class GroupManager {
    private readonly net;
    /**
     * Debugger for log messages.
     */
    private readonly debug;
    private readonly groups;
    constructor(net: Network);
    /**
     * Handle a node becoming available. In this case ask the node to send
     * us all the groups it is a member of.
     *
     * @param node -
     *   node that is available
     */
    private handleNodeAvailable;
    /**
     * Handle a node becoming unavailable. This will remove it from all
     * groups that are currently active.
     *
     * @param node -
     *   node that is no longer available
     */
    private handleNodeUnavailable;
    private handleMessage;
    /**
     * Handle an incoming request to join an group.
     *
     * @param node -
     *   node message comes from
     * @param id -
     *   id of group being joined
     */
    private handleGroupJoin;
    /**
     * Handle an incoming request to leave an group.
     *
     * @param node -
     *   node message comes from
     * @param id -
     *   group being left
     */
    private handleGroupLeave;
    /**
     * Handle incoming information about all the groups a node is a member
     * of.
     *
     * @param node -
     *   node message comes from
     * @param groups -
     *   groups that the node is a member of
     */
    private handleGroupMembership;
    private handleGroupQuery;
    getSharedGroup(id: string): () => SharedGroup;
    private ensureSharedGroup;
}
//# sourceMappingURL=GroupManager.d.ts.map