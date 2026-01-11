import { getDb, type User, type UserSettings, type SubscriptionTier } from "../index";

export interface CreateUserInput {
  telegramId: string;
  telegramChatId: string;
  telegramUsername?: string;
}

export interface UserWithSettings extends User {
  settings: UserSettings;
  tier: SubscriptionTier;
}

// Find user by Telegram ID
export async function findByTelegramId(telegramId: string): Promise<User | null> {
  const db = await getDb();
  const row = db
    .query("SELECT * FROM users WHERE telegram_id = ?")
    .get(telegramId) as User | null;
  return row;
}

// Find user by internal ID
export async function findById(id: number): Promise<User | null> {
  const db = await getDb();
  const row = db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
  return row;
}

// Create new user with default settings
export async function createUser(input: CreateUserInput): Promise<User> {
  const db = await getDb();

  // Insert user
  db.run(
    `INSERT INTO users (telegram_id, telegram_chat_id, telegram_username)
     VALUES (?, ?, ?)`,
    [input.telegramId, input.telegramChatId, input.telegramUsername || null]
  );

  // Get the created user
  const user = db
    .query("SELECT * FROM users WHERE telegram_id = ?")
    .get(input.telegramId) as User;

  // Create default settings
  db.run("INSERT INTO user_settings (user_id) VALUES (?)", [user.id]);

  return user;
}

// Update last active timestamp
export async function updateLastActive(userId: number): Promise<void> {
  const db = await getDb();
  db.run(
    "UPDATE users SET last_active_at = strftime('%s', 'now') WHERE id = ?",
    [userId]
  );
}

// Get user settings
export async function getSettings(userId: number): Promise<UserSettings | null> {
  const db = await getDb();
  const row = db
    .query("SELECT * FROM user_settings WHERE user_id = ?")
    .get(userId) as UserSettings | null;
  return row;
}

// Update user settings
export async function updateSettings(
  userId: number,
  updates: Partial<UserSettings>
): Promise<void> {
  const db = await getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "user_id" && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  fields.push("updated_at = strftime('%s', 'now')");
  values.push(userId);

  db.run(
    `UPDATE user_settings SET ${fields.join(", ")} WHERE user_id = ?`,
    values as (string | number | boolean | null)[]
  );
}

// Get subscription tier for user
export async function getTier(userId: number): Promise<SubscriptionTier> {
  const db = await getDb();
  const user = await findById(userId);

  const tier = db
    .query("SELECT * FROM subscription_tiers WHERE id = ?")
    .get(user?.subscription_tier || "free") as SubscriptionTier;

  return tier;
}

// Get user with settings and tier (full context)
export async function getUserContext(telegramId: string): Promise<UserWithSettings | null> {
  const user = await findByTelegramId(telegramId);
  if (!user) return null;

  const settings = await getSettings(user.id);
  if (!settings) return null;

  const tier = await getTier(user.id);

  return {
    ...user,
    settings,
    tier,
  };
}

// Update subscription
export async function updateSubscription(
  userId: number,
  updates: {
    subscriptionTier?: string;
    subscriptionExpiresAt?: number | null;
    stripeCustomerId?: string;
  }
): Promise<void> {
  const db = await getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.subscriptionTier !== undefined) {
    fields.push("subscription_tier = ?");
    values.push(updates.subscriptionTier);
  }
  if (updates.subscriptionExpiresAt !== undefined) {
    fields.push("subscription_expires_at = ?");
    values.push(updates.subscriptionExpiresAt);
  }
  if (updates.stripeCustomerId !== undefined) {
    fields.push("stripe_customer_id = ?");
    values.push(updates.stripeCustomerId);
  }

  if (fields.length === 0) return;
  values.push(userId);

  db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
}

// Count total users
export async function countUsers(): Promise<number> {
  const db = await getDb();
  const row = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

// Get all active users (for bulk operations)
export async function getAllActiveUsers(): Promise<User[]> {
  const db = await getDb();
  const rows = db
    .query("SELECT * FROM users WHERE is_active = 1 AND is_banned = 0")
    .all() as User[];
  return rows;
}
