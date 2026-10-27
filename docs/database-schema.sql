-- Generated PostgreSQL schema reference. Apply upgrades through Alembic, not this file.


CREATE TABLE app_settings (
	id SERIAL NOT NULL,
	revision INTEGER NOT NULL,
	values JSON NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT ck_app_settings_singleton CHECK (id = 1),
	CONSTRAINT ck_app_settings_revision CHECK (revision >= 1)
)

;

CREATE TABLE mail_messages (
	id SERIAL NOT NULL,
	delivery_key VARCHAR(100) NOT NULL,
	folder VARCHAR(20) NOT NULL,
	sender TEXT NOT NULL,
	recipient TEXT NOT NULL,
	subject TEXT NOT NULL,
	body TEXT NOT NULL,
	raw BYTEA NOT NULL,
	is_read BOOLEAN NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (delivery_key)
)

;
CREATE INDEX ix_mail_messages_folder ON mail_messages (folder);

CREATE TABLE map_categories (
	kind VARCHAR(16) NOT NULL,
	key VARCHAR(64) NOT NULL,
	label VARCHAR(120) NOT NULL,
	description TEXT NOT NULL,
	active BOOLEAN DEFAULT true NOT NULL,
	llm_enabled BOOLEAN DEFAULT true NOT NULL,
	supports_completion BOOLEAN DEFAULT false NOT NULL,
	position INTEGER DEFAULT '0' NOT NULL,
	PRIMARY KEY (kind, key),
	CONSTRAINT ck_map_category_kind CHECK (kind IN ('topic','entry')),
	CONSTRAINT ck_map_categories_position CHECK (position >= 0),
	CONSTRAINT ck_map_category_label CHECK (length(key) > 0 AND length(trim(label)) > 0)
)

;

CREATE TABLE processed_stripe_events (
	id SERIAL NOT NULL,
	stripe_event_id VARCHAR(255) NOT NULL,
	event_type VARCHAR(120) NOT NULL,
	processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_processed_stripe_events_id ON processed_stripe_events (id);
CREATE UNIQUE INDEX ix_processed_stripe_events_stripe_event_id ON processed_stripe_events (stripe_event_id);

CREATE TABLE users (
	id SERIAL NOT NULL,
	email VARCHAR(320) NOT NULL,
	username VARCHAR(80) NOT NULL,
	hashed_password VARCHAR(255) NOT NULL,
	display_name VARCHAR(120),
	bio VARCHAR(500),
	avatar_url VARCHAR(500),
	auth_provider VARCHAR(40) NOT NULL,
	is_email_verified BOOLEAN NOT NULL,
	email_verified_at TIMESTAMP WITH TIME ZONE,
	email_verification_token_hash VARCHAR(128),
	email_verification_sent_at TIMESTAMP WITH TIME ZONE,
	email_verification_attempts INTEGER DEFAULT '0' NOT NULL,
	password_reset_token_hash VARCHAR(128),
	password_reset_sent_at TIMESTAMP WITH TIME ZONE,
	last_login_at TIMESTAMP WITH TIME ZONE,
	is_active BOOLEAN NOT NULL,
	role VARCHAR(16) DEFAULT 'member' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (email_verification_token_hash),
	UNIQUE (password_reset_token_hash)
)

;
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE INDEX ix_users_id ON users (id);
CREATE UNIQUE INDEX ix_users_username ON users (username);

CREATE TABLE billing_subscriptions (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	stripe_customer_id VARCHAR(255),
	stripe_subscription_id VARCHAR(255),
	stripe_price_id VARCHAR(255),
	status VARCHAR(40) NOT NULL,
	cancel_at_period_end BOOLEAN NOT NULL,
	current_period_end TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_billing_subscriptions_id ON billing_subscriptions (id);
CREATE UNIQUE INDEX ix_billing_subscriptions_stripe_customer_id ON billing_subscriptions (stripe_customer_id);
CREATE UNIQUE INDEX ix_billing_subscriptions_stripe_subscription_id ON billing_subscriptions (stripe_subscription_id);
CREATE UNIQUE INDEX ix_billing_subscriptions_user_id ON billing_subscriptions (user_id);

CREATE TABLE chat_sessions (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	chat_id VARCHAR(120) NOT NULL,
	title VARCHAR(120) DEFAULT 'New chat' NOT NULL,
	title_source VARCHAR(32) DEFAULT 'automatic' NOT NULL,
	initial_topic_title_set BOOLEAN DEFAULT '0' NOT NULL,
	message_count INTEGER DEFAULT '0' NOT NULL,
	next_position INTEGER DEFAULT '0' NOT NULL,
	conversation_summary TEXT,
	summary_message_count INTEGER DEFAULT '0' NOT NULL,
	analysis_status VARCHAR(32) DEFAULT 'idle' NOT NULL,
	analysed_message_count INTEGER,
	analysis_error TEXT,
	info JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_chat_sessions_user_chat UNIQUE (user_id, chat_id),
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;
CREATE INDEX ix_chat_sessions_chat_id ON chat_sessions (chat_id);
CREATE INDEX ix_chat_sessions_id ON chat_sessions (id);
CREATE INDEX ix_chat_sessions_user_updated_id ON chat_sessions (user_id, updated_at, id);

CREATE TABLE daily_llm_usage (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	usage_date VARCHAR(10) NOT NULL,
	message_count INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_daily_llm_usage_user_date UNIQUE (user_id, usage_date),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_daily_llm_usage_id ON daily_llm_usage (id);
CREATE INDEX ix_daily_llm_usage_usage_date ON daily_llm_usage (usage_date);
CREATE INDEX ix_daily_llm_usage_user_id ON daily_llm_usage (user_id);

CREATE TABLE feedback (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	category VARCHAR(24) NOT NULL,
	message TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_feedback_user_id ON feedback (user_id);

CREATE TABLE journal_entries (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	entry_date VARCHAR(10) NOT NULL,
	content TEXT NOT NULL,
	analysis JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_journal_entries_user_date UNIQUE (user_id, entry_date),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_journal_entries_entry_date ON journal_entries (entry_date);
CREATE INDEX ix_journal_entries_id ON journal_entries (id);
CREATE INDEX ix_journal_entries_user_id ON journal_entries (user_id);

CREATE TABLE terms_acceptances (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	version VARCHAR(80) NOT NULL,
	document_url VARCHAR(2048) NOT NULL,
	document_sha256 VARCHAR(64) NOT NULL,
	accepted_at TIMESTAMP WITH TIME ZONE NOT NULL,
	client VARCHAR(16) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_terms_user_version UNIQUE (user_id, version),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_terms_acceptances_user_id ON terms_acceptances (user_id);

CREATE TABLE user_profiles (
	id SERIAL NOT NULL,
	user_id INTEGER NOT NULL,
	data JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (user_id),
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;
CREATE INDEX ix_user_profiles_id ON user_profiles (id);

CREATE TABLE chat_turns (
	id SERIAL NOT NULL,
	chat_session_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	user_input TEXT,
	llm_response TEXT,
	status VARCHAR(16) DEFAULT 'pending' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	responded_at TIMESTAMP WITH TIME ZONE,
	user_timestamp VARCHAR(64),
	response_timestamp VARCHAR(64),
	user_metadata JSON NOT NULL,
	response_metadata JSON NOT NULL,
	reaction VARCHAR(16),
	PRIMARY KEY (id),
	CONSTRAINT uq_chat_turns_session_position UNIQUE (chat_session_id, position),
	CONSTRAINT ck_chat_turns_positive_position CHECK (position > 0),
	CONSTRAINT ck_chat_turns_status CHECK (status IN ('pending', 'completed', 'failed', 'legacy')),
	FOREIGN KEY(chat_session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_chat_turns_session_created ON chat_turns (chat_session_id, created_at);
CREATE INDEX ix_chat_turns_session_status_position ON chat_turns (chat_session_id, status, position);

CREATE TABLE user_maps (
	user_id INTEGER NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	extra_ciphertext BYTEA,
	content_key_id VARCHAR(80) NOT NULL,
	PRIMARY KEY (user_id),
	FOREIGN KEY(user_id) REFERENCES user_profiles (user_id) ON DELETE CASCADE,
	CONSTRAINT ck_map_revision CHECK (revision >= 1),
	CONSTRAINT ck_user_maps_key_id CHECK (length(content_key_id) > 0),
	CONSTRAINT ck_user_maps_extra_ciphertext_length CHECK (length(extra_ciphertext) >= 28)
)

;

CREATE TABLE map_topics (
	user_id INTEGER NOT NULL,
	id VARCHAR(64) NOT NULL,
	parent_topic_id VARCHAR(64),
	category_kind VARCHAR(16) DEFAULT 'topic' NOT NULL,
	category VARCHAR(64) NOT NULL,
	position INTEGER NOT NULL,
	content_key_id VARCHAR(80) NOT NULL,
	title_ciphertext BYTEA NOT NULL,
	description_ciphertext BYTEA NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE,
	updated_at TIMESTAMP WITH TIME ZONE,
	extra_ciphertext BYTEA,
	PRIMARY KEY (user_id, id),
	FOREIGN KEY(category_kind, category) REFERENCES map_categories (kind, key),
	FOREIGN KEY(user_id, parent_topic_id) REFERENCES map_topics (user_id, id) DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT ck_map_parent_self CHECK (parent_topic_id IS NULL OR parent_topic_id <> id),
	CONSTRAINT ck_map_topic_kind CHECK (category_kind = 'topic'),
	FOREIGN KEY(user_id) REFERENCES user_maps (user_id) ON DELETE CASCADE,
	CONSTRAINT ck_map_topics_position CHECK (position >= 0),
	CONSTRAINT ck_map_topics_key_id CHECK (length(content_key_id) > 0),
	CONSTRAINT ck_map_topics_id CHECK (length(id) > 0),
	CONSTRAINT ck_map_topics_title_ciphertext_length CHECK (length(title_ciphertext) >= 28),
	CONSTRAINT ck_map_topics_description_ciphertext_length CHECK (length(description_ciphertext) >= 28),
	CONSTRAINT ck_map_topics_extra_ciphertext_length CHECK (length(extra_ciphertext) >= 28)
)

;
CREATE INDEX ix_map_topics_category ON map_topics (user_id, category);
CREATE INDEX ix_map_topics_parent ON map_topics (user_id, parent_topic_id);

CREATE TABLE map_entries (
	user_id INTEGER NOT NULL,
	id VARCHAR(64) NOT NULL,
	topic_id VARCHAR(64),
	category_kind VARCHAR(16) DEFAULT 'entry' NOT NULL,
	category VARCHAR(64) NOT NULL,
	position INTEGER NOT NULL,
	completion_percent INTEGER,
	practice_status VARCHAR(16),
	content_key_id VARCHAR(80) NOT NULL,
	text_ciphertext BYTEA NOT NULL,
	reason_ciphertext BYTEA,
	reflection_ciphertext BYTEA,
	source_topic_title_ciphertext BYTEA,
	source_user_id INTEGER,
	source_chat_id VARCHAR(120),
	source_chat_reference VARCHAR(120),
	source_topic_reference VARCHAR(64),
	created_at TIMESTAMP WITH TIME ZONE,
	updated_at TIMESTAMP WITH TIME ZONE,
	extra_ciphertext BYTEA,
	working_on BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (user_id, id),
	FOREIGN KEY(category_kind, category) REFERENCES map_categories (kind, key),
	FOREIGN KEY(user_id, topic_id) REFERENCES map_topics (user_id, id) DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY(source_user_id, source_chat_id) REFERENCES chat_sessions (user_id, chat_id) ON DELETE SET NULL,
	CONSTRAINT ck_map_entry_kind CHECK (category_kind = 'entry'),
	CONSTRAINT ck_map_entry_source_owner CHECK (source_user_id IS NULL OR source_user_id = user_id),
	CONSTRAINT ck_map_entry_source_pair CHECK ((source_user_id IS NULL) = (source_chat_id IS NULL)),
	CONSTRAINT ck_map_completion CHECK (completion_percent IS NULL OR completion_percent BETWEEN 0 AND 100),
	CONSTRAINT ck_map_practice_status CHECK (practice_status IS NULL OR practice_status IN ('active','paused','completed')),
	FOREIGN KEY(user_id) REFERENCES user_maps (user_id) ON DELETE CASCADE,
	CONSTRAINT ck_map_entries_position CHECK (position >= 0),
	CONSTRAINT ck_map_entry_reference CHECK (source_chat_id IS NULL OR source_chat_id = source_chat_reference),
	CONSTRAINT ck_map_entries_key_id CHECK (length(content_key_id) > 0),
	CONSTRAINT ck_map_entries_id CHECK (length(id) > 0),
	CONSTRAINT ck_map_entries_text_ciphertext_length CHECK (length(text_ciphertext) >= 28),
	CONSTRAINT ck_map_entries_reason_ciphertext_length CHECK (length(reason_ciphertext) >= 28),
	CONSTRAINT ck_map_entries_reflection_ciphertext_length CHECK (length(reflection_ciphertext) >= 28),
	CONSTRAINT ck_map_entries_source_topic_title_ciphertext_length CHECK (length(source_topic_title_ciphertext) >= 28),
	CONSTRAINT ck_map_entries_extra_ciphertext_length CHECK (length(extra_ciphertext) >= 28)
)

;
CREATE INDEX ix_map_entries_progress ON map_entries (user_id, category, completion_percent);
CREATE INDEX ix_map_entries_source_chat ON map_entries (source_user_id, source_chat_id);
CREATE INDEX ix_map_entries_topic ON map_entries (user_id, topic_id, position);

CREATE TABLE map_topic_relations (
	user_id INTEGER NOT NULL,
	topic_a_id VARCHAR(64) NOT NULL,
	topic_b_id VARCHAR(64) NOT NULL,
	PRIMARY KEY (user_id, topic_a_id, topic_b_id),
	FOREIGN KEY(user_id, topic_a_id) REFERENCES map_topics (user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, topic_b_id) REFERENCES map_topics (user_id, id) ON DELETE CASCADE,
	CONSTRAINT ck_map_relation_order CHECK (topic_a_id < topic_b_id)
)

;
CREATE INDEX ix_map_relations_reverse ON map_topic_relations (user_id, topic_b_id);

CREATE TABLE map_topic_sources (
	user_id INTEGER NOT NULL,
	topic_id VARCHAR(64) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	reference VARCHAR(120) NOT NULL,
	position INTEGER NOT NULL,
	source_user_id INTEGER,
	source_chat_id VARCHAR(120),
	PRIMARY KEY (user_id, topic_id, kind, reference),
	FOREIGN KEY(user_id, topic_id) REFERENCES map_topics (user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(source_user_id, source_chat_id) REFERENCES chat_sessions (user_id, chat_id) ON DELETE SET NULL,
	CONSTRAINT ck_map_source_kind CHECK (kind IN ('chat','journal')),
	CONSTRAINT ck_map_source_owner CHECK (source_user_id IS NULL OR source_user_id = user_id),
	CONSTRAINT ck_map_source_pair CHECK ((source_user_id IS NULL) = (source_chat_id IS NULL)),
	CONSTRAINT ck_map_topic_sources_position CHECK (position >= 0),
	CONSTRAINT ck_map_source_reference CHECK (source_chat_id IS NULL OR (kind = 'chat' AND source_chat_id = reference))
)

;
CREATE INDEX ix_map_sources_chat ON map_topic_sources (source_user_id, source_chat_id);
