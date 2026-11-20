use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    if env::var_os("CARGO_FEATURE_STANDALONE").is_none() {
        return Ok(());
    }

    let dist = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../frontend/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    assert!(
        dist.join("index.html").is_file(),
        "Run npm ci and npm run build in frontend/ before building with --features standalone"
    );

    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("frontend.rs");
    let mut output = fs::File::create(output)?;
    writeln!(
        output,
        "fn embedded_asset(path: &str) -> Option<&'static [u8]> {{"
    )?;
    writeln!(output, "    match path {{")?;
    write_assets(&dist, &dist, &mut output)?;
    writeln!(output, "        _ => None,\n    }}\n}}")
}

fn write_assets(root: &Path, directory: &Path, output: &mut fs::File) -> io::Result<()> {
    let mut entries = fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            write_assets(root, &path, output)?;
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            writeln!(
                output,
                "        {relative:?} => Some(include_bytes!({path:?})),"
            )?;
        }
    }
    Ok(())
}
