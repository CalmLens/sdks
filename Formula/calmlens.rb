class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.24.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.24.0/calmlens-0.24.0-darwin-arm64.tar.gz"
      sha256 "9db1a3d2ca22e09ce41cb6200f674850eed3f907d146743b7b46fcb6ce9b882e"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.24.0/calmlens-0.24.0-darwin-x64.tar.gz"
      sha256 "0da5b2c25f84afa75a87b1ad0f4840664d2cdedb3dd337fc8dc4b4def2eaf839"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.24.0/calmlens-0.24.0-linux-arm64.tar.gz"
      sha256 "ba3839cec1a2b69b1609986f6ce8398aaa22fa85c37bc650ea9f3c138691a00a"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.24.0/calmlens-0.24.0-linux-x64.tar.gz"
      sha256 "681f7c0ad80588be8c5ad1208240aa527b979fdcb4cedcd12c5c57bd3e482c85"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
