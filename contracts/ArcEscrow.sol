// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ArcEscrow
/// @notice 基于 Arc 的可编程 USDC 条件托管。
///         Arc 上 USDC 是原生 gas 币,所以这里用原生转账(msg.value)锁定和释放资金,
///         无需 ERC-20 approve。
contract ArcEscrow {
    enum Status {
        Active, // 资金已锁定,等待放款或退款
        Released, // 已放款给收款方
        Refunded // 已退款给付款方
    }

    struct Escrow {
        address payer; // 付款方
        address payee; // 收款方
        uint256 amount; // 锁定金额(原生 USDC,18 位小数)
        uint256 deadline; // 截止时间(unix 时间戳);到期后付款方可退款
        string memo; // 结构化备注:发票号 / 项目名等,方便对账
        Status status; // 当前状态
    }

    uint256 public nextId; // 下一个托管的编号(前端从 0 遍历到 nextId-1)
    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 deadline,
        string memo
    );
    event EscrowReleased(uint256 indexed id, address indexed payee, uint256 amount);
    event EscrowRefunded(uint256 indexed id, address indexed payer, uint256 amount);

    /// @notice 付款方创建并注资一笔托管(把要锁的 USDC 作为 msg.value 一起发送)
    /// @param payee 收款方地址
    /// @param deadline 截止时间戳,必须晚于当前时间
    /// @param memo 备注(发票号/项目名等)
    /// @return id 新建托管的编号
    function createEscrow(
        address payee,
        uint256 deadline,
        string calldata memo
    ) external payable returns (uint256 id) {
        require(msg.value > 0, "amount must be > 0");
        require(payee != address(0), "invalid payee");
        require(payee != msg.sender, "payer cannot be payee");
        require(deadline > block.timestamp, "deadline must be in the future");

        id = nextId++;
        escrows[id] = Escrow({
            payer: msg.sender,
            payee: payee,
            amount: msg.value,
            deadline: deadline,
            memo: memo,
            status: Status.Active
        });

        emit EscrowCreated(id, msg.sender, payee, msg.value, deadline, memo);
    }

    /// @notice 付款方确认交付,放款给收款方
    function release(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.status == Status.Active, "escrow not active");
        require(msg.sender == e.payer, "only payer can release");

        e.status = Status.Released; // 先改状态,再转账(防重入)
        (bool ok, ) = e.payee.call{value: e.amount}("");
        require(ok, "transfer to payee failed");

        emit EscrowReleased(id, e.payee, e.amount);
    }

    /// @notice 到期后仍未放款,付款方取回资金
    function refund(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.status == Status.Active, "escrow not active");
        require(msg.sender == e.payer, "only payer can refund");
        require(block.timestamp >= e.deadline, "deadline not reached yet");

        e.status = Status.Refunded; // 先改状态,再转账(防重入)
        (bool ok, ) = e.payer.call{value: e.amount}("");
        require(ok, "refund to payer failed");

        emit EscrowRefunded(id, e.payer, e.amount);
    }
}
