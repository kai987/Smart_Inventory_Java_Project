CREATE TABLE `operation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	CONSTRAINT "operation_guards_ok_check" CHECK("operation_guards"."ok" = 1)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`item_order` integer NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`unit_price_yen` text NOT NULL,
	`unit_weight_kg` real NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal_yen` text NOT NULL,
	`total_weight_kg` real NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`order_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" > 0),
	CONSTRAINT "order_items_weight_check" CHECK("order_items"."unit_weight_kg" > 0 AND "order_items"."total_weight_kg" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_order_items_order_position` ON `order_items` (`order_id`,`item_order`);--> statement-breakpoint
CREATE TABLE `orders` (
	`order_id` text PRIMARY KEY NOT NULL,
	`customer_name` text NOT NULL,
	`total_price_yen` text NOT NULL,
	`total_weight_kg` real NOT NULL,
	`estimated_boxes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_name`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_weight_check" CHECK("orders"."total_weight_kg" >= 0),
	CONSTRAINT "orders_boxes_check" CHECK("orders"."estimated_boxes" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_orders_customer_created` ON `orders` (`customer_name`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_yen` text NOT NULL,
	`stock` integer NOT NULL,
	`weight_kg` real NOT NULL,
	CONSTRAINT "products_stock_check" CHECK("products"."stock" >= 0),
	CONSTRAINT "products_weight_check" CHECK("products"."weight_kg" > 0)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`csrf_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('ADMIN', 'CUSTOMER'))
);
