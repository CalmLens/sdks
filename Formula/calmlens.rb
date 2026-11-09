class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.23.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.0/calmlens-0.23.0-darwin-arm64.tar.gz"
      sha256 "ccd02d5552ea9e79771e6494374bfd59bd80f8414e7e710d703c24072085ecd2"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.0/calmlens-0.23.0-darwin-x64.tar.gz"
      sha256 "6e136cdb397c368c123667971f96f25fab70b4603bb3ecef39495b4809f8af86"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.0/calmlens-0.23.0-linux-arm64.tar.gz"
      sha256 "e13eb80e768b68db317ff71877dc1e49e0095631dea2e1f2d85cc0a4c61f5026"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.0/calmlens-0.23.0-linux-x64.tar.gz"
      sha256 "3d1ba9074b1653decfd29b666b31acf96e9c1fda0c306b5e83c2b200b94a9e56"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
