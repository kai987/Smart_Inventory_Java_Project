use serde::{Deserialize, Serialize, Serializer, ser::SerializeStruct};

use crate::error::{Code, DomainError, FieldError};

pub const BOX_LIMIT_KG: f64 = 10.0;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    Admin,
    Customer,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct User {
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: Role,
}

impl User {
    pub(crate) fn to_csv(&self) -> String {
        let role = match self.role {
            Role::Admin => "ADMIN",
            Role::Customer => "CUSTOMER",
        };
        format!("{},{},{}", self.username, self.password_hash, role)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub id: String,
    pub name: String,
    pub price_yen: i64,
    pub stock: i32,
    pub weight_kg: f64,
}

impl Product {
    pub fn new(
        id: String,
        name: String,
        price_yen: i64,
        stock: i32,
        weight_kg: f64,
    ) -> Result<Self, DomainError> {
        if !valid_product_id(&id) {
            return Err(validation("id", "Use P followed by three digits."));
        }
        if !valid_product_name(&name) {
            return Err(validation(
                "name",
                "Product name is invalid or contains a reserved character.",
            ));
        }
        if price_yen <= 0 {
            return Err(validation("priceYen", "Price must be a positive integer."));
        }
        if stock < 0 {
            return Err(validation("stock", "Stock cannot be negative."));
        }
        if !positive_finite(weight_kg) {
            return Err(validation(
                "weightKg",
                "Weight must be positive and finite.",
            ));
        }
        Ok(Self {
            id,
            name,
            price_yen,
            stock,
            weight_kg,
        })
    }

    pub(crate) fn from_csv(line: &str) -> Option<Self> {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() != 5 {
            return None;
        }
        Self::new(
            fields[0].trim().to_owned(),
            fields[1].trim().to_owned(),
            parse_csv_price(fields[2].trim())?,
            fields[3].trim().parse().ok()?,
            fields[4].trim().parse().ok()?,
        )
        .ok()
    }

    pub(crate) fn to_csv(&self) -> String {
        format!(
            "{},{},{},{},{}",
            self.id, self.name, self.price_yen, self.stock, self.weight_kg
        )
    }
}

impl Serialize for Product {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Product", 6)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("priceYen", &self.price_yen.to_string())?;
        state.serialize_field("stock", &self.stock)?;
        state.serialize_field("weightKg", &self.weight_kg)?;
        state.serialize_field("available", &(self.stock > 0))?;
        state.end()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestedItem {
    pub product_id: String,
    pub quantity: i32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    pub product_id: String,
    pub product_name: String,
    #[serde(serialize_with = "serialize_yen")]
    pub unit_price_yen: i64,
    pub unit_weight_kg: f64,
    pub quantity: i32,
    #[serde(serialize_with = "serialize_yen")]
    pub subtotal_yen: i64,
    pub total_weight_kg: f64,
}

impl OrderItem {
    pub fn new(product: &Product, quantity: i32) -> Result<Self, DomainError> {
        if quantity <= 0 {
            return Err(validation("quantity", "Quantity must be positive."));
        }
        let subtotal_yen = product
            .price_yen
            .checked_mul(i64::from(quantity))
            .ok_or_else(|| {
                DomainError::with_message(
                    Code::ValidationError,
                    "Order item subtotal is too large.",
                )
            })?;
        let total_weight_kg = product.weight_kg * f64::from(quantity);
        if !positive_finite(total_weight_kg) {
            return Err(DomainError::with_message(
                Code::ValidationError,
                "Order item total weight is too large.",
            ));
        }
        Ok(Self {
            product_id: product.id.clone(),
            product_name: product.name.clone(),
            unit_price_yen: product.price_yen,
            unit_weight_kg: product.weight_kg,
            quantity,
            subtotal_yen,
            total_weight_kg,
        })
    }

    fn to_csv_part(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}",
            self.product_id,
            self.product_name,
            self.unit_price_yen,
            self.unit_weight_kg,
            self.quantity
        )
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub order_id: String,
    pub customer_name: String,
    pub items: Vec<OrderItem>,
    #[serde(serialize_with = "serialize_yen")]
    pub total_price_yen: i64,
    pub total_weight_kg: f64,
    pub estimated_boxes: i32,
}

impl Order {
    pub fn new(
        order_id: String,
        customer_name: String,
        items: Vec<OrderItem>,
    ) -> Result<Self, DomainError> {
        if order_id.trim().is_empty()
            || contains_reserved_character(&order_id)
            || !valid_username(&customer_name)
            || items.is_empty()
        {
            return Err(DomainError::new(Code::ValidationError));
        }
        let mut total_price_yen = 0_i64;
        let mut total_weight_kg = 0_f64;
        for item in &items {
            total_price_yen = total_price_yen
                .checked_add(item.subtotal_yen)
                .ok_or_else(|| {
                    DomainError::with_message(
                        Code::ValidationError,
                        "Order total price is too large.",
                    )
                })?;
            total_weight_kg += item.total_weight_kg;
            if !positive_finite(total_weight_kg) {
                return Err(DomainError::with_message(
                    Code::ValidationError,
                    "Order total weight is too large.",
                ));
            }
        }
        let boxes = (total_weight_kg / BOX_LIMIT_KG).ceil();
        if boxes > f64::from(i32::MAX) {
            return Err(DomainError::with_message(
                Code::ValidationError,
                "Order requires too many boxes.",
            ));
        }
        Ok(Self {
            order_id,
            customer_name,
            items,
            total_price_yen,
            total_weight_kg,
            estimated_boxes: boxes as i32,
        })
    }

    pub(crate) fn from_csv(line: &str, products: &[Product]) -> Option<Self> {
        let fields: Vec<&str> = line.splitn(3, ',').collect();
        if fields.len() != 3 {
            return None;
        }
        let mut items = Vec::new();
        for raw_item in fields[2].split('|') {
            let parts: Vec<&str> = raw_item.split(':').collect();
            let item = match parts.as_slice() {
                [id, quantity] => OrderItem::new(
                    products.iter().find(|product| product.id == id.trim())?,
                    quantity.trim().parse().ok()?,
                )
                .ok()?,
                [id, name, price, weight, quantity] => OrderItem::new(
                    &Product::new(
                        id.trim().to_owned(),
                        name.trim().to_owned(),
                        price.trim().parse().ok()?,
                        0,
                        weight.trim().parse().ok()?,
                    )
                    .ok()?,
                    quantity.trim().parse().ok()?,
                )
                .ok()?,
                _ => return None,
            };
            items.push(item);
        }
        Self::new(
            fields[0].trim().to_owned(),
            fields[1].trim().to_owned(),
            items,
        )
        .ok()
    }

    pub(crate) fn to_csv(&self) -> String {
        format!(
            "{},{},{}",
            self.order_id,
            self.customer_name,
            self.items
                .iter()
                .map(OrderItem::to_csv_part)
                .collect::<Vec<_>>()
                .join("|")
        )
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub product_count: usize,
    pub total_stock: i64,
    pub order_count: usize,
    pub customer_count: usize,
    pub low_stock_count: usize,
    pub low_stock_threshold: i32,
    pub inventory_value_yen: String,
}

pub fn valid_username(value: &str) -> bool {
    (3..=20).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

pub fn valid_raw_password(value: &str) -> bool {
    (4..=100).contains(&value.encode_utf16().count())
        && value.len() <= 72
        && !value.trim().is_empty()
        && !contains_reserved_character(value)
}

pub fn valid_product_id(value: &str) -> bool {
    value.len() == 4
        && value.starts_with('P')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_digit)
}

pub fn valid_product_name(value: &str) -> bool {
    !value.trim().is_empty()
        && value.encode_utf16().count() <= 100
        && !contains_reserved_character(value)
}

pub fn contains_reserved_character(value: &str) -> bool {
    value.contains([',', '|', ':', '\n', '\r'])
}

pub fn positive_finite(value: f64) -> bool {
    value > 0.0 && value.is_finite()
}

pub fn verify_password(raw: &str, encoded: &str) -> bool {
    // Spring Security rejects passwords over bcrypt's 72-byte limit. The Rust
    // crate's default silently truncates, so guard before hashing or verifying.
    if raw.len() > 72 {
        return false;
    }
    let hash = encoded.strip_prefix("{bcrypt}").unwrap_or(encoded);
    bcrypt::verify(raw, hash).unwrap_or(false)
}

pub(crate) fn encode_password(raw: &str) -> Result<String, DomainError> {
    if raw.len() > 72 {
        return Err(validation(
            "password",
            "Password must not exceed 72 UTF-8 bytes.",
        ));
    }
    bcrypt::hash(raw, 10)
        .map(|hash| format!("{{bcrypt}}{hash}"))
        .map_err(|_| DomainError::with_message(Code::InternalError, "Password hashing failed."))
}

pub(crate) fn validation(field: impl Into<String>, message: impl Into<String>) -> DomainError {
    let message = message.into();
    DomainError {
        code: Code::ValidationError,
        message: "Please check the submitted values.".to_owned(),
        field_errors: vec![FieldError {
            field: field.into(),
            message,
        }],
    }
}

fn serialize_yen<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}

// BigDecimal.longValueExact compatibility without conversion through floating point.
fn parse_csv_price(value: &str) -> Option<i64> {
    let (negative, unsigned) = if let Some(rest) = value.strip_prefix('-') {
        (true, rest)
    } else {
        (false, value.strip_prefix('+').unwrap_or(value))
    };
    let mut scientific = unsigned.split(['e', 'E']);
    let mantissa = scientific.next()?;
    let exponent = scientific
        .next()
        .map(str::parse::<i32>)
        .transpose()
        .ok()?
        .unwrap_or(0);
    if scientific.next().is_some() {
        return None;
    }
    let mut decimal = mantissa.split('.');
    let whole = decimal.next()?;
    let fraction = decimal.next().unwrap_or("");
    if decimal.next().is_some()
        || (whole.is_empty() && fraction.is_empty())
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let digits = format!("{whole}{fraction}");
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return Some(0);
    }
    let scale = i64::try_from(fraction.len()).ok()? - i64::from(exponent);
    let integral = if scale >= 0 {
        let scale = usize::try_from(scale).ok()?;
        if scale >= digits.len()
            || !digits[digits.len() - scale..]
                .bytes()
                .all(|byte| byte == b'0')
        {
            return None;
        }
        digits[..digits.len() - scale].to_owned()
    } else {
        let zeroes = usize::try_from(-scale).ok()?;
        if digits.len().checked_add(zeroes)? > 19 {
            return None;
        }
        format!("{digits}{}", "0".repeat(zeroes))
    };
    if negative {
        format!("-{integral}").parse().ok()
    } else {
        integral.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn product(price: i64, weight: f64) -> Product {
        Product::new("P001".into(), "日本語商品".into(), price, 8, weight).unwrap()
    }

    #[test]
    fn json_matches_frontend_contract_without_exposing_passwords() {
        let value = serde_json::to_value(product(i64::MAX, 1.0)).unwrap();
        assert_eq!(value["priceYen"], i64::MAX.to_string());
        assert_eq!(value["available"], true);
        let user = User {
            username: "alice".into(),
            password_hash: "secret".into(),
            role: Role::Customer,
        };
        assert_eq!(
            serde_json::to_value(user).unwrap(),
            json!({"username":"alice", "role":"CUSTOMER"})
        );
    }

    #[test]
    fn whole_decimal_csv_prices_are_exact() {
        for text in ["120000", "120000.0", "1.2e5", "+00120000.000"] {
            assert_eq!(parse_csv_price(text), Some(120000));
        }
        for text in [
            "1.5",
            "NaN",
            "1e9999999999",
            "1e-99999",
            "9223372036854775808",
            ".",
            "1e1e1",
        ] {
            assert_eq!(parse_csv_price(text), None, "{text}");
        }
        assert_eq!(parse_csv_price("9223372036854775807.0"), Some(i64::MAX));
    }

    #[test]
    fn malformed_order_overflow_and_non_finite_values_are_rejected() {
        for line in [
            "O1,alice,P001:ItemA:9223372036854775807:1:2",
            "O2,alice,P001:ItemA:4611686018427387904:1:1|P002:ItemB:4611686018427387904:1:1",
            "O3,alice,P001:ItemA:1:1.7976931348623157e308:2",
            "O4,alice,P001:ItemA:1:1.7976931348623157e308:1",
            "O5,alice,P001:ItemA:1:NaN:1",
            "O6,alice,P001:ItemA:1:1:1|",
        ] {
            assert!(Order::from_csv(line, &[]).is_none(), "{line}");
        }
    }

    #[test]
    fn legacy_order_snapshot_and_box_boundary_are_preserved() {
        let original = product(500, 10.0);
        let legacy = Order::from_csv("O1,alice,P001:2", &[original]).unwrap();
        assert_eq!(legacy.total_price_yen, 1000);
        assert_eq!(legacy.estimated_boxes, 2);
        assert_eq!(Order::from_csv(&legacy.to_csv(), &[]).unwrap(), legacy);
        let over = Order::new(
            "O2".into(),
            "alice".into(),
            vec![OrderItem::new(&product(1, 10.01), 1).unwrap()],
        )
        .unwrap();
        assert_eq!(over.estimated_boxes, 2);
    }

    #[test]
    fn identifiers_and_utf16_limits_follow_java_rules() {
        assert!(!valid_product_id("p001"));
        assert!(!valid_product_id("P１２３"));
        assert!(!valid_username("日本語"));
        assert!(valid_product_name(&"😀".repeat(50)));
        assert!(!valid_product_name(&"😀".repeat(51)));
        assert!(!valid_raw_password("    "));
        assert!(!valid_raw_password("pass:word"));
    }

    #[test]
    fn bcrypt_variants_and_password_byte_limit_match_java() {
        let password = "日本語".repeat(8);
        assert!(valid_raw_password(&password));
        let hash = bcrypt::hash(&password, 4).unwrap();
        for prefix in ["$2a$", "$2b$", "$2y$"] {
            let encoded = format!("{{bcrypt}}{}{}", prefix, &hash[4..]);
            assert!(verify_password(&password, &encoded));
            assert!(!verify_password("different password", &encoded));
        }
        assert!(verify_password(password.as_str(), &hash));
        let too_long = format!("{password}a");
        assert!(!valid_raw_password(&too_long));
        assert!(!verify_password(&too_long, &hash));
        assert!(encode_password(&too_long).is_err());
    }
}
