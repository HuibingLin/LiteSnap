use napi_derive::napi;
use screenshots::Screen;
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

#[napi]
pub fn capture_screen() -> Vec<u8> {
    let screens = Screen::all().unwrap();
    let image = screens[0].capture().unwrap();

    let dynamic_img = DynamicImage::ImageRgba8(image);

    let mut png_data = Vec::new();
    dynamic_img
        .write_to(&mut Cursor::new(&mut png_data), ImageFormat::Png)
        .expect("Failed to encode image as PNG");

    png_data
}
