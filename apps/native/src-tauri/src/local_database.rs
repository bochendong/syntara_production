use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri_plugin_sql::{DbInstances, DbPool};

const LOCAL_DATABASE: &str = "sqlite:syntara-local.db";

async fn transaction_pool(options: SqliteConnectOptions) -> Result<SqlitePool, sqlx::Error> {
    // JS BEGIN/COMMIT commands are separate plugin calls. They must always use
    // the same connection, which must not expire in the middle of a transaction.
    SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await
}

#[tauri::command]
pub async fn configure_local_database(
    instances: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let mut databases = instances.0.write().await;
    let Some(DbPool::Sqlite(pool)) = databases.get(LOCAL_DATABASE) else {
        return Err("本地学习数据库尚未打开。".into());
    };
    let options = (*pool.connect_options()).clone();
    let replacement = transaction_pool(options)
        .await
        .map_err(|error| error.to_string())?;
    let previous = databases.insert(LOCAL_DATABASE.into(), DbPool::Sqlite(replacement));
    drop(databases);
    if let Some(DbPool::Sqlite(pool)) = previous {
        pool.close().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[test]
    fn separate_plugin_calls_share_transaction_and_rollback() {
        tauri::async_runtime::block_on(async {
            let pool = transaction_pool(SqliteConnectOptions::new().in_memory(true))
                .await
                .unwrap();
            sqlx::query("CREATE TABLE messages (text TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("BEGIN IMMEDIATE").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO messages VALUES ('kept')")
                .execute(&pool)
                .await
                .unwrap();
            // A read between writes must stay on the same transaction as well.
            let row = sqlx::query("SELECT COUNT(*) AS count FROM messages")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<i64, _>("count"), 1);
            sqlx::query("COMMIT").execute(&pool).await.unwrap();
            sqlx::query("BEGIN IMMEDIATE").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO messages VALUES ('discarded')")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("ROLLBACK").execute(&pool).await.unwrap();
            let row = sqlx::query("SELECT text FROM messages")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("text"), "kept");
            pool.close().await;
        });
    }
}
