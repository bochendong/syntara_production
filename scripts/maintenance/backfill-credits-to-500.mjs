// Historical backfills must not recreate balances after retirement.
console.error('积分系统已退役，历史积分补发脚本已停用，不会读取或修改数据库。');
process.exitCode = 1;
