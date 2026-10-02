use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use fs2::FileExt;
use num_bigint::BigInt;
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use uuid::Uuid;

use crate::{
    domain::{
        Order, OrderItem, Product, RequestedItem, Role, Summary, User, encode_password,
        valid_product_id, valid_raw_password, valid_username, validation,
    },
    error::{Code, DomainError, FieldError},
};

const FILE_NAMES: [&str; 3] = ["users.csv", "products.csv", "orders.csv"];
const SEEDS: [&str; 3] = [
    include_str!("../../backend/src/main/resources/seed-data/users.csv"),
    include_str!("../../backend/src/main/resources/seed-data/products.csv"),
    include_str!("../../backend/src/main/resources/seed-data/orders.csv"),
];
const JOURNAL_NAME: &str = ".smart-inventory-transaction.json";
type PasswordMigrations = Vec<(usize, String)>;

/// Owns one runtime directory. A process-wide API mutex serializes mutations, and
/// the advisory file lock excludes other Rust instances. Java does not take this lock.
#[derive(Debug)]
pub struct Store {
    directory: PathBuf,
    _lock: File,
    users: Vec<User>,
    products: Vec<Product>,
    orders: Vec<Order>,
    snapshots: [Option<String>; 3],
    #[cfg(test)]
    fail_after_writes: Option<usize>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TransactionState {
    Prepared,
    Committed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u8,
    state: TransactionState,
    files: Vec<JournalFile>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct JournalFile {
    filename: String,
    original: Option<String>,
    replacement: String,
}

impl Store {
    pub fn open(data_dir: &Path) -> Result<Self, DomainError> {
        fs::create_dir_all(data_dir)
            .map_err(|_| persistence("Could not create the data directory."))?;
        let directory = fs::canonicalize(data_dir)
            .map_err(|_| persistence("Could not resolve the data directory."))?;
        let lock_path = directory.join(".smart-inventory.lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|metadata| !metadata.is_file()) {
            return Err(persistence(
                "The data directory lock is not a regular file.",
            ));
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|_| persistence("Could not open the data directory lock."))?;
        FileExt::try_lock_exclusive(&lock).map_err(|_| {
            persistence("Another Rust backend is already using this data directory.")
        })?;
        recover_journal(&directory)?;

        let snapshots = [
            read_optional_file(&directory.join(FILE_NAMES[0]))?,
            read_optional_file(&directory.join(FILE_NAMES[1]))?,
            read_optional_file(&directory.join(FILE_NAMES[2]))?,
        ];
        // Parse every existing file before seeds or password migrations touch disk.
        let source: [&str; 3] =
            std::array::from_fn(|index| snapshots[index].as_deref().unwrap_or(SEEDS[index]));
        let (mut users, migrations) = parse_users(source[0])?;
        let products = parse_products(source[1])?;
        let orders = parse_orders(source[2], &products)?;
        for (index, raw) in migrations {
            users[index].password_hash = encode_password(&raw)?;
        }

        let serialized_users = csv_lines(users.iter().map(User::to_csv));
        let mut initial_writes = Vec::new();
        for index in 0..3 {
            if snapshots[index].is_none()
                || (index == 0 && users_need_save(source[0], &users))
                || (index == 2 && contains_legacy_order_items(source[2]))
            {
                let content = match index {
                    0 => serialized_users.clone(),
                    2 if contains_legacy_order_items(source[2]) => {
                        csv_lines(orders.iter().map(Order::to_csv))
                    }
                    _ => source[index].to_owned(),
                };
                initial_writes.push((index, content));
            }
        }
        let mut store = Self {
            directory,
            _lock: lock,
            users,
            products,
            orders,
            snapshots,
            #[cfg(test)]
            fail_after_writes: None,
        };
        if !initial_writes.is_empty() {
            store.persist(initial_writes)?;
        }
        Ok(store)
    }

    pub fn find_user(&self, username: &str) -> Option<User> {
        self.users
            .iter()
            .find(|user| user.username.eq_ignore_ascii_case(username))
            .cloned()
    }

    pub fn register(&mut self, username: &str, raw_password: &str) -> Result<User, DomainError> {
        if !valid_username(username) {
            return Err(validation(
                "username",
                "Use 3-20 letters, numbers, or underscores.",
            ));
        }
        if !valid_raw_password(raw_password) {
            return Err(validation(
                "password",
                "Use 4-100 characters and at most 72 UTF-8 bytes, without reserved delimiters.",
            ));
        }
        if self.find_user(username).is_some() {
            return Err(DomainError::new(Code::UsernameExists));
        }
        let user = User {
            username: username.to_owned(),
            password_hash: encode_password(raw_password)?,
            role: Role::Customer,
        };
        let mut replacement = self.users.clone();
        replacement.push(user.clone());
        self.persist(vec![(0, csv_lines(replacement.iter().map(User::to_csv)))])?;
        self.users = replacement;
        Ok(user)
    }

    pub fn list_products(&self, query: Option<&str>, in_stock_only: bool) -> Vec<Product> {
        let keyword = query.unwrap_or("").trim().to_lowercase();
        self.products
            .iter()
            .filter(|product| {
                (!in_stock_only || product.stock > 0)
                    && (product.id.to_lowercase().contains(&keyword)
                        || product.name.to_lowercase().contains(&keyword))
            })
            .cloned()
            .collect()
    }

    pub fn get_product(&self, id: &str) -> Result<Product, DomainError> {
        self.products
            .iter()
            .find(|product| product.id == id)
            .cloned()
            .ok_or_else(|| DomainError::new(Code::ProductNotFound))
    }

    pub fn add_product(
        &mut self,
        id: &str,
        name: &str,
        price_yen: &str,
        stock: i32,
        weight_kg: f64,
    ) -> Result<Product, DomainError> {
        if !price_yen.starts_with(|character: char| ('1'..='9').contains(&character))
            || !price_yen.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(validation("priceYen", "Price must be a positive integer."));
        }
        let price = price_yen
            .parse::<i64>()
            .map_err(|_| validation("priceYen", "Price is outside the supported range."))?;
        let product = Product::new(id.to_owned(), name.to_owned(), price, stock, weight_kg)?;
        if self.products.iter().any(|existing| existing.id == id) {
            return Err(DomainError::new(Code::ProductExists));
        }
        let mut replacement = self.products.clone();
        replacement.push(product.clone());
        self.persist(vec![(
            1,
            csv_lines(replacement.iter().map(Product::to_csv)),
        )])?;
        self.products = replacement;
        Ok(product)
    }

    pub fn update_stock(&mut self, id: &str, stock: i32) -> Result<Product, DomainError> {
        let index = self
            .products
            .iter()
            .position(|product| product.id == id)
            .ok_or_else(|| DomainError::new(Code::ProductNotFound))?;
        if stock < 0 {
            return Err(validation("stock", "Stock cannot be negative."));
        }
        let mut replacement = self.products.clone();
        replacement[index].stock = stock;
        self.persist(vec![(
            1,
            csv_lines(replacement.iter().map(Product::to_csv)),
        )])?;
        let result = replacement[index].clone();
        self.products = replacement;
        Ok(result)
    }

    pub fn delete_product(&mut self, id: &str) -> Result<(), DomainError> {
        if !self.products.iter().any(|product| product.id == id) {
            return Err(DomainError::new(Code::ProductNotFound));
        }
        let replacement: Vec<Product> = self
            .products
            .iter()
            .filter(|product| product.id != id)
            .cloned()
            .collect();
        self.persist(vec![(
            1,
            csv_lines(replacement.iter().map(Product::to_csv)),
        )])?;
        self.products = replacement;
        Ok(())
    }

    pub fn create_order(
        &mut self,
        customer: &str,
        items: Vec<RequestedItem>,
    ) -> Result<Order, DomainError> {
        if !valid_username(customer) {
            return Err(DomainError::new(Code::ValidationError));
        }
        if items.is_empty() {
            return Err(DomainError::new(Code::EmptyOrder));
        }
        // Preserve the first occurrence order and field index when merging duplicates.
        let mut merged: Vec<(String, i32, usize)> = Vec::new();
        for (index, item) in items.into_iter().enumerate() {
            if !valid_product_id(&item.product_id) {
                return Err(validation(
                    format!("items[{index}].productId"),
                    "Use P followed by three digits.",
                ));
            }
            if item.quantity <= 0 {
                return Err(validation(
                    format!("items[{index}].quantity"),
                    "Quantity must be positive.",
                ));
            }
            self.get_product(&item.product_id)?;
            if let Some((_, quantity, _)) =
                merged.iter_mut().find(|(id, _, _)| id == &item.product_id)
            {
                *quantity = quantity.checked_add(item.quantity).ok_or_else(|| {
                    validation(
                        format!("items[{index}].quantity"),
                        "The combined item quantity is too large.",
                    )
                })?;
            } else {
                merged.push((item.product_id, item.quantity, index));
            }
        }
        let mut order_items = Vec::new();
        for (id, quantity, index) in &merged {
            let product = self.get_product(id)?;
            if *quantity > product.stock {
                let mut error = DomainError::new(Code::InsufficientStock);
                error.field_errors.push(FieldError {
                    field: format!("items[{index}].quantity"),
                    message: "Requested quantity exceeds available stock.".into(),
                });
                return Err(error);
            }
            order_items.push(OrderItem::new(&product, *quantity)?);
        }
        let order = Order::new(
            format!("O{}", Uuid::new_v4().simple()),
            customer.to_owned(),
            order_items,
        )?;
        let mut products = self.products.clone();
        for (id, quantity, _) in merged {
            if let Some(product) = products.iter_mut().find(|product| product.id == id) {
                product.stock -= quantity;
            }
        }
        let mut orders = self.orders.clone();
        orders.push(order.clone());
        self.persist(vec![
            (1, csv_lines(products.iter().map(Product::to_csv))),
            (2, csv_lines(orders.iter().map(Order::to_csv))),
        ])?;
        self.products = products;
        self.orders = orders;
        Ok(order)
    }

    pub fn orders_for_customer(&self, username: &str) -> Vec<Order> {
        self.orders
            .iter()
            .filter(|order| order.customer_name.eq_ignore_ascii_case(username))
            .cloned()
            .collect()
    }

    pub fn all_orders(&self, customer: Option<&str>) -> Vec<Order> {
        match customer.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => self.orders_for_customer(value),
            None => self.orders.clone(),
        }
    }

    pub fn summary(&self, threshold: i32) -> Summary {
        let value = self
            .products
            .iter()
            .fold(BigInt::from(0), |total, product| {
                total + BigInt::from(product.price_yen) * BigInt::from(product.stock)
            });
        Summary {
            product_count: self.products.len(),
            total_stock: self
                .products
                .iter()
                .map(|product| i64::from(product.stock))
                .sum(),
            order_count: self.orders.len(),
            customer_count: self
                .users
                .iter()
                .filter(|user| user.role == Role::Customer)
                .count(),
            low_stock_count: self
                .products
                .iter()
                .filter(|product| product.stock <= threshold)
                .count(),
            low_stock_threshold: threshold,
            inventory_value_yen: value.to_string(),
        }
    }

    fn persist(&mut self, updates: Vec<(usize, String)>) -> Result<(), DomainError> {
        recover_journal(&self.directory)?;
        // Detect an uncoordinated Java/external writer instead of silently overwriting
        // its changes. This is a best-effort check, not a lock honored by Java.
        for (index, filename) in FILE_NAMES.iter().enumerate() {
            if read_optional_file(&self.directory.join(filename))? != self.snapshots[index] {
                return Err(persistence(
                    "CSV data changed outside this process. Stop other writers and restart the backend.",
                ));
            }
        }
        let mut journal = Journal {
            version: 1,
            state: TransactionState::Prepared,
            files: updates
                .iter()
                .map(|(index, replacement)| JournalFile {
                    filename: FILE_NAMES[*index].into(),
                    original: self.snapshots[*index].clone(),
                    replacement: replacement.clone(),
                })
                .collect(),
        };
        write_journal(&self.directory, &journal)?;

        #[cfg(test)]
        let failure_point = self.fail_after_writes.take();
        let result = (|| -> Result<(), DomainError> {
            #[cfg(test)]
            let mut writes = 0;
            for file in &journal.files {
                write_atomic(
                    &self.directory.join(&file.filename),
                    file.replacement.as_bytes(),
                )
                .map_err(|_| persistence("Could not save the CSV transaction."))?;
                #[cfg(test)]
                {
                    writes += 1;
                    if failure_point == Some(writes) {
                        return Err(persistence("Simulated transaction failure."));
                    }
                }
            }
            sync_directory(&self.directory)
                .map_err(|_| persistence("Could not synchronize the CSV transaction."))?;
            journal.state = TransactionState::Committed;
            write_journal(&self.directory, &journal)?;
            Ok(())
        })();

        if let Err(error) = result {
            // Use the in-memory prepared journal even if persisting the commit marker
            // failed after a rename; no successful response has been returned yet.
            journal.state = TransactionState::Prepared;
            if write_journal(&self.directory, &journal).is_err()
                || rollback(&self.directory, &journal).is_err()
            {
                return Err(persistence(
                    "CSV save and rollback could not complete. Preserve the transaction journal and repair the data directory before restarting.",
                ));
            }
            return Err(error);
        }
        for (index, content) in updates {
            self.snapshots[index] = Some(content);
        }
        // A committed journal is safe to leave for startup cleanup. Never report a
        // failed order after durable commit solely because this cleanup failed.
        let _ = remove_journal(&self.directory);
        Ok(())
    }
}

fn parse_users(source: &str) -> Result<(Vec<User>, PasswordMigrations), DomainError> {
    if source.is_empty() {
        return Err(persistence(
            "users.csv is empty; refusing to replace existing accounts.",
        ));
    }
    let mut users = Vec::new();
    let mut migrations = Vec::new();
    let mut names = HashSet::new();
    for (index, line) in source.lines().enumerate() {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() != 3 {
            return Err(invalid_row("users.csv", index));
        }
        let username = fields[0].trim();
        let stored = fields[1];
        let role = match fields[2].trim() {
            "ADMIN" => Role::Admin,
            "CUSTOMER" => Role::Customer,
            _ => return Err(invalid_row("users.csv", index)),
        };
        if !valid_username(username) || !names.insert(username.to_ascii_lowercase()) {
            return Err(invalid_row("users.csv", index));
        }
        let password_hash = if let Some(hash) = stored.strip_prefix("{bcrypt}") {
            validate_bcrypt(hash).map_err(|_| invalid_row("users.csv", index))?;
            stored.to_owned()
        } else if ["$2a$", "$2b$", "$2y$"]
            .iter()
            .any(|prefix| stored.starts_with(prefix))
        {
            validate_bcrypt(stored).map_err(|_| invalid_row("users.csv", index))?;
            format!("{{bcrypt}}{stored}")
        } else {
            let raw = if let Some(raw) = stored.strip_prefix("{noop}") {
                raw
            } else {
                if stored.starts_with('{') && stored.contains('}') {
                    return Err(persistence(
                        "users.csv uses an unsupported password encoding; the original file was preserved.",
                    ));
                }
                stored
            };
            if !valid_raw_password(raw) {
                return Err(invalid_row("users.csv", index));
            }
            migrations.push((index, raw.to_owned()));
            stored.to_owned()
        };
        users.push(User {
            username: username.into(),
            password_hash,
            role,
        });
    }
    if users.is_empty() {
        return Err(persistence("users.csv must contain at least one account."));
    }
    Ok((users, migrations))
}

fn users_need_save(source: &str, users: &[User]) -> bool {
    source
        .lines()
        .zip(users)
        .any(|(line, user)| line.split(',').nth(1) != Some(&user.password_hash))
}

fn validate_bcrypt(hash: &str) -> Result<(), ()> {
    if hash.len() != 60
        || !["$2a$", "$2b$", "$2y$"]
            .iter()
            .any(|prefix| hash.starts_with(prefix))
    {
        return Err(());
    }
    // Validate parameters/base64 without executing a potentially expensive hash
    // during startup. Bcrypt uses its own alphabet and canonical padding bits.
    let bytes = hash.as_bytes();
    if bytes[6] != b'$'
        || !bytes[4..6].iter().all(u8::is_ascii_digit)
        || !bytes[7..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'.' || *byte == b'/')
        || !b".Oeu".contains(&bytes[28])
        || !b".CGKOSWaeimquy26".contains(&bytes[59])
    {
        return Err(());
    }
    let parts = hash.parse::<bcrypt::HashParts>().map_err(|_| ())?;
    if !(4..=31).contains(&parts.get_cost()) {
        return Err(());
    }
    Ok(())
}

fn contains_legacy_order_items(source: &str) -> bool {
    source
        .lines()
        .filter_map(|line| line.splitn(3, ',').nth(2))
        .flat_map(|items| items.split('|'))
        .any(|item| item.split(':').count() == 2)
}

fn parse_products(source: &str) -> Result<Vec<Product>, DomainError> {
    let mut ids = HashSet::new();
    source
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let product =
                Product::from_csv(line).ok_or_else(|| invalid_row("products.csv", index))?;
            if !ids.insert(product.id.clone()) {
                return Err(invalid_row("products.csv", index));
            }
            Ok(product)
        })
        .collect()
}

fn parse_orders(source: &str, products: &[Product]) -> Result<Vec<Order>, DomainError> {
    let mut ids = HashSet::new();
    source
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let order =
                Order::from_csv(line, products).ok_or_else(|| invalid_row("orders.csv", index))?;
            if !ids.insert(order.order_id.clone()) {
                return Err(invalid_row("orders.csv", index));
            }
            Ok(order)
        })
        .collect()
}

fn csv_lines(lines: impl Iterator<Item = String>) -> String {
    lines.map(|line| format!("{line}\n")).collect()
}

fn read_optional_file(path: &Path) -> Result<Option<String>, DomainError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => fs::read_to_string(path)
            .map(Some)
            .map_err(|_| persistence("A data file could not be read as UTF-8.")),
        Ok(_) => Err(persistence("A required data path is not a regular file.")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(persistence("A required data file could not be inspected.")),
    }
}

fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing parent directory"))?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(contents)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn sync_directory(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(directory)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}

fn write_journal(directory: &Path, journal: &Journal) -> Result<(), DomainError> {
    let json = serde_json::to_vec(journal)
        .map_err(|_| persistence("Could not encode the CSV transaction journal."))?;
    write_atomic(&directory.join(JOURNAL_NAME), &json)
        .and_then(|()| sync_directory(directory))
        .map_err(|_| persistence("Could not save the CSV transaction journal."))
}

fn remove_journal(directory: &Path) -> Result<(), DomainError> {
    fs::remove_file(directory.join(JOURNAL_NAME))
        .and_then(|()| sync_directory(directory))
        .map_err(|_| persistence("Could not clean up the CSV transaction journal."))
}

fn recover_journal(directory: &Path) -> Result<(), DomainError> {
    let Some(source) = read_optional_file(&directory.join(JOURNAL_NAME))? else {
        return Ok(());
    };
    let journal: Journal = serde_json::from_str(&source).map_err(|_| {
        persistence("The CSV transaction journal is invalid; restore it before starting.")
    })?;
    let mut names = HashSet::new();
    if journal.version != 1
        || journal.files.is_empty()
        || journal.files.len() > 3
        || journal.files.iter().any(|file| {
            !FILE_NAMES.contains(&file.filename.as_str()) || !names.insert(&file.filename)
        })
    {
        return Err(persistence(
            "The CSV transaction journal contains invalid file references.",
        ));
    }
    match journal.state {
        TransactionState::Prepared => rollback(directory, &journal),
        TransactionState::Committed => {
            for file in &journal.files {
                if read_optional_file(&directory.join(&file.filename))?.as_deref()
                    != Some(&file.replacement)
                {
                    return Err(persistence(
                        "A committed CSV transaction was changed externally; refusing automatic recovery.",
                    ));
                }
            }
            remove_journal(directory)
        }
    }
}

fn rollback(directory: &Path, journal: &Journal) -> Result<(), DomainError> {
    // Validate every target before restoring any, preserving manual/external edits.
    for file in &journal.files {
        let current = read_optional_file(&directory.join(&file.filename))?;
        if current != file.original && current.as_deref() != Some(&file.replacement) {
            return Err(persistence(
                "CSV recovery found external changes; the transaction journal was preserved.",
            ));
        }
    }
    for file in journal.files.iter().rev() {
        let path = directory.join(&file.filename);
        match &file.original {
            Some(original) => write_atomic(&path, original.as_bytes())
                .map_err(|_| persistence("Could not restore a CSV transaction backup."))?,
            None => match fs::remove_file(path) {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                Err(_) => return Err(persistence("Could not remove an incomplete CSV seed file.")),
            },
        }
    }
    sync_directory(directory)
        .map_err(|_| persistence("Could not synchronize restored CSV files."))?;
    remove_journal(directory)
}

fn invalid_row(filename: &str, index: usize) -> DomainError {
    persistence(format!(
        "Invalid or duplicate CSV row in {filename} at line {}.",
        index + 1
    ))
}

fn persistence(message: impl Into<String>) -> DomainError {
    DomainError::with_message(Code::PersistenceError, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::verify_password;

    fn fixture(directory: &Path, products: &str, orders: &str) {
        fs::write(directory.join("users.csv"), SEEDS[0]).unwrap();
        fs::write(directory.join("products.csv"), products).unwrap();
        fs::write(directory.join("orders.csv"), orders).unwrap();
    }

    fn request(id: &str, quantity: i32) -> RequestedItem {
        RequestedItem {
            product_id: id.into(),
            quantity,
        }
    }

    #[test]
    fn fresh_directory_uses_java_seeds_and_only_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("products.csv"), "P999,Custom,1,0,1\n").unwrap();
        let store = Store::open(temp.path()).unwrap();
        assert_eq!(store.products.len(), 1);
        assert_eq!(store.products[0].id, "P999");
        assert_eq!(store.orders.len(), 2);
        assert!(verify_password(
            "admin123",
            &store.find_user("ADMIN").unwrap().password_hash
        ));
        assert!(!temp.path().join(JOURNAL_NAME).exists());
    }

    #[test]
    fn all_files_validate_before_migrating_passwords_or_creating_seeds() {
        let temp = tempfile::tempdir().unwrap();
        let users = "alice,pass123,CUSTOMER\n";
        fs::write(temp.path().join("users.csv"), users).unwrap();
        fs::write(
            temp.path().join("orders.csv"),
            "O1,alice,P001:Name:1:NaN:1\n",
        )
        .unwrap();
        assert!(Store::open(temp.path()).is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("users.csv")).unwrap(),
            users
        );
        assert!(!temp.path().join("products.csv").exists());
        assert!(!temp.path().join(JOURNAL_NAME).exists());
    }

    #[test]
    fn password_forms_migrate_once_and_case_insensitive_duplicates_reject() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "", "");
        let bcrypt = bcrypt::hash("pass123", 4).unwrap();
        let users = format!(
            "alice,pass123,CUSTOMER\nbobby,{{noop}}pass123,CUSTOMER\ncarol,{bcrypt},ADMIN\ndavid,{{bcrypt}}{bcrypt},CUSTOMER\n"
        );
        fs::write(temp.path().join("users.csv"), users).unwrap();
        let mut store = Store::open(temp.path()).unwrap();
        for username in ["alice", "bobby", "carol", "david"] {
            assert!(verify_password(
                "pass123",
                &store.find_user(username).unwrap().password_hash
            ));
        }
        assert!(matches!(
            store.register("ALICE", "password").unwrap_err().code,
            Code::UsernameExists
        ));
        let encoded = fs::read_to_string(temp.path().join("users.csv")).unwrap();
        drop(store);
        drop(Store::open(temp.path()).unwrap());
        assert_eq!(
            fs::read_to_string(temp.path().join("users.csv")).unwrap(),
            encoded
        );
    }

    #[test]
    fn empty_product_and_order_collections_can_restart_but_empty_users_cannot() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "P001,Last,1,0,1\n", "");
        let mut store = Store::open(temp.path()).unwrap();
        store.delete_product("P001").unwrap();
        drop(store);
        let store = Store::open(temp.path()).unwrap();
        assert!(store.products.is_empty());
        assert!(store.orders.is_empty());
        drop(store);
        fs::write(temp.path().join("users.csv"), "").unwrap();
        assert!(Store::open(temp.path()).is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("users.csv")).unwrap(),
            ""
        );
    }

    #[test]
    fn malformed_and_duplicate_rows_preserve_original_files() {
        for (filename, bad) in [
            ("users.csv", "alice,pass123,CUSTOMER\nALICE,pass123,ADMIN\n"),
            ("products.csv", "P001,A,1,1,1\nP001,B,1,1,1\n"),
            ("products.csv", "P001,A,1.1,1,1\n"),
            ("products.csv", "\n"),
            (
                "orders.csv",
                "O1,alice,P001:Name:1:1:1\nO1,alice,P001:Name:1:1:1\n",
            ),
        ] {
            let temp = tempfile::tempdir().unwrap();
            fixture(temp.path(), SEEDS[1], SEEDS[2]);
            fs::write(temp.path().join(filename), bad).unwrap();
            assert!(Store::open(temp.path()).is_err(), "{filename}: {bad}");
            assert_eq!(fs::read_to_string(temp.path().join(filename)).unwrap(), bad);
        }
    }

    #[test]
    fn malformed_bcrypt_parameters_abort_without_rewriting_any_files() {
        let hash = SEEDS[0].lines().next().unwrap().split(',').nth(1).unwrap();
        let bad_cost = hash.replacen("$10$", "$99$", 1);
        let bad_base64 = format!("{{bcrypt}}$2b$10${}", "!".repeat(53));
        let bad_padding = format!("{}B", &hash[..hash.len() - 1]);
        for invalid in [bad_cost, bad_base64, bad_padding] {
            let temp = tempfile::tempdir().unwrap();
            let users = format!("alice,pass123,CUSTOMER\nadmin,{invalid},ADMIN\n");
            fs::write(temp.path().join("users.csv"), &users).unwrap();
            assert!(Store::open(temp.path()).is_err());
            assert_eq!(
                fs::read_to_string(temp.path().join("users.csv")).unwrap(),
                users
            );
            assert!(!temp.path().join("products.csv").exists());
        }
    }

    #[test]
    fn duplicate_items_merge_with_correct_stock_and_insufficient_field_index() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "P001,Laptop,1000,10,1.5\n", "");
        let mut store = Store::open(temp.path()).unwrap();
        let order = store
            .create_order("alice", vec![request("P001", 3), request("P001", 4)])
            .unwrap();
        assert_eq!(order.items.len(), 1);
        assert_eq!(order.items[0].quantity, 7);
        assert_eq!(order.total_price_yen, 7000);
        assert_eq!(store.get_product("P001").unwrap().stock, 3);
        let error = store
            .create_order("alice", vec![request("P001", 2), request("P001", 2)])
            .unwrap_err();
        assert!(matches!(error.code, Code::InsufficientStock));
        assert_eq!(error.field_errors[0].field, "items[0].quantity");
        assert_eq!(store.get_product("P001").unwrap().stock, 3);
        assert_eq!(store.orders.len(), 1);
    }

    #[test]
    fn snapshot_survives_deletion_and_big_summary_is_exact() {
        let temp = tempfile::tempdir().unwrap();
        fixture(
            temp.path(),
            "P001,日本語商品,500,5,2\nP002,Large,9223372036854775807,2147483647,1\n",
            "",
        );
        let mut store = Store::open(temp.path()).unwrap();
        let expected = BigInt::from(i64::MAX) * BigInt::from(i32::MAX) + BigInt::from(2500);
        assert_eq!(store.summary(5).inventory_value_yen, expected.to_string());
        let order = store
            .create_order("alice", vec![request("P001", 2)])
            .unwrap();
        store.delete_product("P001").unwrap();
        drop(store);
        let store = Store::open(temp.path()).unwrap();
        assert_eq!(store.orders_for_customer("ALICE"), vec![order]);
    }

    #[test]
    fn legacy_orders_are_snapshotted_before_product_deletion() {
        let temp = tempfile::tempdir().unwrap();
        fixture(
            temp.path(),
            "P001,日本語商品,500,5,2\n",
            "O1,alice,P001:2\n",
        );
        let mut store = Store::open(temp.path()).unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("orders.csv")).unwrap(),
            "O1,alice,P001:日本語商品:500:2:2\n"
        );
        store.delete_product("P001").unwrap();
        drop(store);
        let store = Store::open(temp.path()).unwrap();
        assert_eq!(store.orders[0].items[0].product_name, "日本語商品");
        assert_eq!(store.orders[0].total_price_yen, 1000);
    }

    #[test]
    fn multi_file_failure_rolls_back_disk_and_memory_then_allows_retry() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "P001,Laptop,1000,5,1\n", "");
        let mut store = Store::open(temp.path()).unwrap();
        store.fail_after_writes = Some(1);
        assert!(
            store
                .create_order("alice", vec![request("P001", 2)])
                .is_err()
        );
        assert_eq!(store.get_product("P001").unwrap().stock, 5);
        assert!(store.orders.is_empty());
        assert_eq!(
            fs::read_to_string(temp.path().join("products.csv")).unwrap(),
            "P001,Laptop,1000,5,1\n"
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("orders.csv")).unwrap(),
            ""
        );
        assert!(!temp.path().join(JOURNAL_NAME).exists());
        store
            .create_order("alice", vec![request("P001", 2)])
            .unwrap();
        drop(store);
        let reopened = Store::open(temp.path()).unwrap();
        assert_eq!(reopened.orders.len(), 1);
        assert_eq!(reopened.get_product("P001").unwrap().stock, 3);
    }

    #[test]
    fn prepared_crash_recovers_originals_and_committed_crash_keeps_new_state() {
        for state in [TransactionState::Prepared, TransactionState::Committed] {
            let temp = tempfile::tempdir().unwrap();
            fixture(temp.path(), "P001,Laptop,1000,5,1\n", "");
            let journal = Journal {
                version: 1,
                state,
                files: vec![
                    JournalFile {
                        filename: "products.csv".into(),
                        original: Some("P001,Laptop,1000,5,1\n".into()),
                        replacement: "P001,Laptop,1000,3,1\n".into(),
                    },
                    JournalFile {
                        filename: "orders.csv".into(),
                        original: Some("".into()),
                        replacement: "O1,alice,P001:Laptop:1000:1:2\n".into(),
                    },
                ],
            };
            write_journal(temp.path(), &journal).unwrap();
            fs::write(
                temp.path().join("products.csv"),
                &journal.files[0].replacement,
            )
            .unwrap();
            if state == TransactionState::Committed {
                fs::write(
                    temp.path().join("orders.csv"),
                    &journal.files[1].replacement,
                )
                .unwrap();
            }
            let store = Store::open(temp.path()).unwrap();
            assert_eq!(
                store.get_product("P001").unwrap().stock,
                if state == TransactionState::Prepared {
                    5
                } else {
                    3
                }
            );
            assert_eq!(
                store.orders.len(),
                usize::from(state == TransactionState::Committed)
            );
            assert!(!temp.path().join(JOURNAL_NAME).exists());
        }
    }

    #[test]
    fn external_edits_and_second_process_lock_are_rejected_without_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(temp.path()).unwrap();
        assert!(Store::open(temp.path()).is_err());
        let external = "P001,External,999,2,1\n";
        fs::write(temp.path().join("products.csv"), external).unwrap();
        assert!(store.update_stock("P001", 99).is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("products.csv")).unwrap(),
            external
        );
        assert_eq!(store.get_product("P001").unwrap().stock, 8);
        drop(store);
        assert!(Store::open(temp.path()).is_ok());
    }

    #[test]
    fn recovery_preserves_unrecognized_external_edits_and_journal() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "P001,Manual,1000,99,1\n", "");
        let journal = Journal {
            version: 1,
            state: TransactionState::Prepared,
            files: vec![JournalFile {
                filename: "products.csv".into(),
                original: Some("P001,Laptop,1000,5,1\n".into()),
                replacement: "P001,Laptop,1000,3,1\n".into(),
            }],
        };
        write_journal(temp.path(), &journal).unwrap();
        assert!(Store::open(temp.path()).is_err());
        assert_eq!(
            fs::read_to_string(temp.path().join("products.csv")).unwrap(),
            "P001,Manual,1000,99,1\n"
        );
        assert!(temp.path().join(JOURNAL_NAME).exists());
    }
}
