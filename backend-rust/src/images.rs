//! Immutable, bounded product images, separate from the frontend/static tree.
use crate::error::{Code, DomainError};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;

#[cfg(test)]
pub(crate) const TEST_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0,
    0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0,
    239, 151, 175, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

pub fn image_mime(filename: &str) -> Option<&'static str> {
    let (stem, extension) = filename.rsplit_once('.')?;
    if stem.len() != 36 || Uuid::parse_str(stem).ok()?.to_string() != stem {
        return None;
    }
    match extension {
        "png" => Some("image/png"),
        "jpg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

pub fn extension(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

pub fn validate_image(bytes: &[u8], mime: &str) -> Result<(), DomainError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(DomainError::new(Code::ImageSize));
    }
    if bytes.is_empty() {
        return Err(DomainError::new(Code::ImageEmpty));
    }
    let valid = match mime {
        "image/png" => png(bytes),
        "image/jpeg" => jpeg(bytes),
        "image/webp" => webp(bytes),
        _ => false,
    };
    if !valid {
        return Err(DomainError::new(Code::ImageType));
    }
    Ok(())
}

fn png(bytes: &[u8]) -> bool {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    let mut position = 8usize;
    let mut header = false;
    let mut data = false;
    while position
        .checked_add(12)
        .is_some_and(|end| end <= bytes.len())
    {
        let size = u32::from_be_bytes(bytes[position..position + 4].try_into().unwrap()) as usize;
        let Some(end) = position
            .checked_add(12)
            .and_then(|end| end.checked_add(size))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        let kind = &bytes[position + 4..position + 8];
        if !header {
            if kind != b"IHDR"
                || size != 13
                || bytes[position + 8..position + 12] == [0; 4]
                || bytes[position + 12..position + 16] == [0; 4]
            {
                return false;
            }
            header = true;
        } else if kind == b"IHDR" {
            return false;
        }
        if kind == b"IDAT" && size > 0 {
            data = true;
        }
        if kind == b"IEND" {
            return size == 0 && data && end == bytes.len();
        }
        position = end;
    }
    false
}

fn jpeg(bytes: &[u8]) -> bool {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return false;
    }
    let mut position = 2usize;
    let mut scan = false;
    let mut frame = false;
    let mut saw_scan = false;
    let mut entropy = false;
    while position < bytes.len() {
        if scan {
            let start = position;
            while position < bytes.len() && bytes[position] != 0xff {
                position += 1;
            }
            entropy |= position > start;
        }
        if bytes.get(position) != Some(&0xff) {
            return false;
        }
        while bytes.get(position) == Some(&0xff) {
            position += 1;
        }
        let Some(&marker) = bytes.get(position) else {
            return false;
        };
        position += 1;
        if scan && (marker == 0 || (0xd0..=0xd7).contains(&marker)) {
            continue;
        }
        if marker == 0xd9 {
            return frame && saw_scan && entropy && position == bytes.len();
        }
        if marker == 0xd8 || marker == 0 || (0xd0..=0xd7).contains(&marker) {
            return false;
        }
        if marker == 1 {
            continue;
        }
        if position + 2 > bytes.len() {
            return false;
        }
        let size = u16::from_be_bytes([bytes[position], bytes[position + 1]]) as usize;
        if size < 2 || position + size > bytes.len() {
            return false;
        }
        if matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            if size < 8
                || bytes[position + 3..position + 5] == [0; 2]
                || bytes[position + 5..position + 7] == [0; 2]
                || bytes[position + 7] == 0
                || size < 8 + 3 * usize::from(bytes[position + 7])
            {
                return false;
            }
            frame = true;
        }
        scan = marker == 0xda;
        if scan {
            if size < 6 || !frame {
                return false;
            }
            saw_scan = true;
        }
        position += size;
    }
    false
}

fn webp(bytes: &[u8]) -> bool {
    if bytes.len() < 20
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize != bytes.len() - 8
    {
        return false;
    }
    webp_frames(bytes, 12, bytes.len(), true)
}

fn webp_frames(bytes: &[u8], start: usize, limit: usize, allow_animation: bool) -> bool {
    let mut position = start;
    let mut frame = false;
    while position + 8 <= limit {
        let kind = &bytes[position..position + 4];
        let size =
            u32::from_le_bytes(bytes[position + 4..position + 8].try_into().unwrap()) as usize;
        let Some(end) = position
            .checked_add(8)
            .and_then(|value| value.checked_add(size))
            .and_then(|value| value.checked_add(size % 2))
        else {
            return false;
        };
        if end > limit {
            return false;
        }
        let payload = &bytes[position + 8..position + 8 + size];
        match kind {
            b"VP8 " => {
                if size < 11
                    || payload[3..6] != [0x9d, 0x01, 0x2a]
                    || u16::from_le_bytes([payload[6], payload[7]]) & 0x3fff == 0
                    || u16::from_le_bytes([payload[8], payload[9]]) & 0x3fff == 0
                {
                    return false;
                }
                frame = true;
            }
            b"VP8L" => {
                if size < 6 || payload[0] != 0x2f || payload[4] & 0xe0 != 0 {
                    return false;
                }
                frame = true;
            }
            b"VP8X" => {
                if size != 10 {
                    return false;
                }
            }
            b"ANMF" => {
                if !allow_animation
                    || size < 30
                    || !webp_frames(bytes, position + 24, position + 8 + size, false)
                {
                    return false;
                }
                frame = true;
            }
            _ => {}
        }
        position = end;
    }
    frame && position == limit
}

fn image_directory(directory: &Path, create: bool) -> Result<PathBuf, DomainError> {
    let mut path = directory.to_owned();
    for component in ["uploads", "product-images"] {
        path.push(component);
        if create && !path.exists() {
            fs::create_dir(&path).map_err(|_| DomainError::new(Code::PersistenceError))?;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|_| DomainError::new(Code::NotFound))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(DomainError::new(Code::PersistenceError));
        }
    }
    Ok(path)
}

pub fn save_image(directory: &Path, mime: &str, bytes: &[u8]) -> Result<String, DomainError> {
    validate_image(bytes, mime)?;
    let extension = extension(mime).ok_or_else(|| DomainError::new(Code::ImageType))?;
    let directory = image_directory(directory, true)?;
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    let mut temporary =
        NamedTempFile::new_in(&directory).map_err(|_| DomainError::new(Code::PersistenceError))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| DomainError::new(Code::PersistenceError))?;
    temporary
        .persist_noclobber(directory.join(&filename))
        .map_err(|_| DomainError::new(Code::PersistenceError))?;
    Ok(format!("/api/product-images/{filename}"))
}

pub fn read_image(
    directory: &Path,
    filename: &str,
) -> Result<(Vec<u8>, &'static str), DomainError> {
    let mime = image_mime(filename).ok_or_else(|| DomainError::new(Code::NotFound))?;
    let path = image_directory(directory, false)?.join(filename);
    let metadata = fs::symlink_metadata(&path).map_err(|_| DomainError::new(Code::NotFound))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_IMAGE_BYTES as u64
    {
        return Err(DomainError::new(Code::NotFound));
    }
    let bytes = fs::read(path).map_err(|_| DomainError::new(Code::NotFound))?;
    validate_image(&bytes, mime).map_err(|_| DomainError::new(Code::NotFound))?;
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_structure_and_size_fail_closed() {
        assert!(validate_image(TEST_PNG, "image/png").is_ok());
        for invalid in [
            &TEST_PNG[..8],
            &TEST_PNG[..TEST_PNG.len() - 1],
            b"<svg></svg>",
        ] {
            assert_eq!(
                validate_image(invalid, "image/png").unwrap_err().code,
                Code::ImageType
            );
        }
        assert_eq!(
            validate_image(TEST_PNG, "image/jpeg").unwrap_err().code,
            Code::ImageType
        );
        assert_eq!(
            validate_image(&[], "image/png").unwrap_err().code,
            Code::ImageEmpty
        );
        assert_eq!(
            validate_image(&vec![0; MAX_IMAGE_BYTES + 1], "image/png")
                .unwrap_err()
                .code,
            Code::ImageSize
        );
        for invalid in [
            "../../users.csv",
            "00000000-0000-0000-0000-000000000000.svg",
            "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.png",
            "a.png?x=y",
        ] {
            assert!(image_mime(invalid).is_none());
        }
    }

    #[test]
    fn complete_jpeg_and_webp_files_are_accepted_and_truncation_is_rejected() {
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xdb, 0, 67, 0];
        jpeg.extend([1; 64]);
        jpeg.extend([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
        jpeg.extend([0xff, 0xc4, 0, 20, 0, 1]);
        jpeg.extend([0; 15]);
        jpeg.push(0);
        jpeg.extend([0xff, 0xc4, 0, 20, 0x10, 1]);
        jpeg.extend([0; 15]);
        jpeg.push(0);
        jpeg.extend([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x3f, 0xff, 0xd9]);
        let webp = include_bytes!("../../frontend/public/product-images/laptop.webp");
        for (bytes, mime) in [
            (jpeg.as_slice(), "image/jpeg"),
            (webp.as_slice(), "image/webp"),
        ] {
            assert!(validate_image(bytes, mime).is_ok(), "{mime}");
            assert_eq!(
                validate_image(&bytes[..bytes.len() - 1], mime)
                    .unwrap_err()
                    .code,
                Code::ImageType
            );
        }
    }

    #[test]
    fn immutable_uploaded_image_persists_and_symlinks_are_not_followed() {
        let directory = tempfile::tempdir().unwrap();
        let url = save_image(directory.path(), "image/png", TEST_PNG).unwrap();
        let filename = url.strip_prefix("/api/product-images/").unwrap();
        assert_eq!(read_image(directory.path(), filename).unwrap().0, TEST_PNG);
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join("uploads/product-images")
                    .join(filename)
            )
            .unwrap(),
            TEST_PNG
        );
        assert_eq!(
            read_image(directory.path(), "../users.csv")
                .unwrap_err()
                .code,
            Code::NotFound
        );
        #[cfg(unix)]
        {
            let other = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(
                other.path(),
                directory.path().join("uploads").join("linked"),
            )
            .unwrap();
            let linked = "00000000-0000-0000-0000-000000000000.png";
            std::os::unix::fs::symlink(
                directory
                    .path()
                    .join("uploads/product-images")
                    .join(filename),
                directory.path().join("uploads/product-images").join(linked),
            )
            .unwrap();
            assert_eq!(
                read_image(directory.path(), linked).unwrap_err().code,
                Code::NotFound
            );
        }
    }
}
