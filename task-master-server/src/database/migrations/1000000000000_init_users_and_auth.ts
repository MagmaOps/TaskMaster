import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Users and authentication tables.
 *
 * - users: account. password_hash is NULLABLE so Google-only accounts work.
 * - oauth_accounts: links external identities (Google) to a user.
 * - refresh_tokens: revocable, rotating sessions (token stored as SHA-256 hash).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // gen_random_uuid() ships with Postgres 13+ via pgcrypto/built-in; ensure available.
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: false },
    display_name: { type: 'varchar(255)', notNull: false },
    avatar_url: { type: 'varchar(1024)', notNull: false },
    tier: {
      type: 'varchar(20)',
      notNull: true,
      default: 'free',
      check: "tier IN ('free','premium')",
    },
    currency_balance: { type: 'bigint', notNull: true, default: 0 },
    settings: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('users', 'created_at', { name: 'idx_users_created_at' });

  pgm.createTable('oauth_accounts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    provider: {
      type: 'varchar(20)',
      notNull: true,
      check: "provider IN ('google')",
    },
    provider_user_id: { type: 'varchar(255)', notNull: true },
    email: { type: 'varchar(255)', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('oauth_accounts', ['provider', 'provider_user_id'], {
    unique: true,
    name: 'idx_oauth_provider_user',
  });
  pgm.createIndex('oauth_accounts', 'user_id', { name: 'idx_oauth_user_id' });

  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    token_hash: { type: 'varchar(255)', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz', notNull: false },
    user_agent: { type: 'varchar(512)', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('refresh_tokens', 'user_id', { name: 'idx_refresh_user_id' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('oauth_accounts');
  pgm.dropTable('users');
  pgm.dropExtension('pgcrypto', { ifExists: true });
}
